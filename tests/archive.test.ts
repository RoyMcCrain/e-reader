import { describe, expect, test } from 'bun:test'
import {
  BlobWriter,
  TextReader,
  ZipReader,
  ZipWriter,
  type Entry,
} from '@zip.js/zip.js'
import { openImageArchive, orderImages } from '../src/reader/archive'

const makeArchive = async (files: Record<string, string>) => {
  const writer = new ZipWriter(new BlobWriter())
  for (const [name, content] of Object.entries(files))
    await writer.add(name, new TextReader(content))
  return new File([await writer.close()], 'test.zip')
}

describe('ZIP画像順序', () => {
  test('公開アーカイブ読み込みは上限超過でZIP列挙を停止する', async () => {
    const original = ZipReader.prototype.getEntriesGenerator
    let requested = 0
    ZipReader.prototype.getEntriesGenerator = async function* () {
      while (true) {
        requested++
        if (requested > 5001) throw new Error('禁止された後続項目')
        yield {
          filename: `${requested}.txt`,
          uncompressedSize: 0,
          directory: false,
        } as Entry
      }
    } as typeof original
    try {
      await expect(
        openImageArchive(new File([new Uint8Array()], 'bounded.zip')),
      ).rejects.toThrow('上限を超えています')
      expect(requested).toBe(5001)
    } finally {
      ZipReader.prototype.getEntriesGenerator = original
    }
  })
  test('実ZIP内の重複画像名を拒否する', async () => {
    const archive = await makeArchive({
      'page1.jpg': 'one',
      'page2.jpg': 'two',
    })
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const first = new TextEncoder().encode('page1.jpg')
    const second = new TextEncoder().encode('page2.jpg')
    for (let offset = 0; offset <= bytes.length - second.length; offset++) {
      if (second.every((byte, index) => bytes[offset + index] === byte))
        bytes.set(first, offset)
    }
    await expect(
      openImageArchive(new File([bytes], 'duplicate.zip')),
    ).rejects.toThrow('重複した画像項目')
  })

  test('自然順に並び、隠し祖先・macOS項目や非画像を除く', () => {
    expect(
      orderImages([
        'image10.jpg',
        '__MACOSX/x.jpg',
        '._x.png',
        'image2.JPG',
        'folder/image1.webp',
        'notes.txt',
        '.hidden.jpg',
        'folder/.hidden/image3.png',
        'nested/__MACOSX/image4.png',
        'vector.svg',
      ]),
    ).toEqual(['folder/image1.webp', 'image2.JPG', 'image10.jpg'])
  })

  test('実際のZIPから画像を展開し、同時要求のURLを共有する', async () => {
    const archiveFile = await makeArchive({ 'page1.jpg': 'image data' })
    const created: string[] = []
    const create = URL.createObjectURL
    URL.createObjectURL = (() => {
      const url = `blob:test-${created.length}`
      created.push(url)
      return url
    }) as typeof URL.createObjectURL
    try {
      const archive = await openImageArchive(archiveFile)
      expect(Object.isFrozen(archive.names)).toBe(true)
      const [first, duplicate] = await Promise.all([
        archive.getUrl(0),
        archive.getUrl(0),
      ])
      expect(first).toBe(duplicate)
      expect(created).toEqual([first])
      await archive.close()
      await expect(archive.getUrl(0)).rejects.toThrow('閉じられています')
    } finally {
      URL.createObjectURL = create
    }
  })

  test('並行展開でも最後に要求した画像をキャッシュする', async () => {
    const archiveFile = await makeArchive({
      '1.jpg': 'one',
      '2.jpg': 'two',
      '3.jpg': 'three',
      '4.jpg': 'four',
    })
    const created: string[] = []
    const create = URL.createObjectURL
    URL.createObjectURL = (() => {
      const url = `blob:parallel-${created.length}`
      created.push(url)
      return url
    }) as typeof URL.createObjectURL
    try {
      const archive = await openImageArchive(archiveFile)
      const urls = await Promise.all(
        [0, 1, 2, 3].map((index) => archive.getUrl(index)),
      )
      expect(created).toHaveLength(4)
      expect(await archive.getUrl(3)).toBe(urls[3])
      expect(created).toHaveLength(4)
      await archive.close()
    } finally {
      URL.createObjectURL = create
    }
  })

  test('実ZIPの展開中にcloseしてもURLを生成せず終了する', async () => {
    const archiveFile = await makeArchive({ 'page1.jpg': 'image data' })
    const created: string[] = []
    const revoked: string[] = []
    const create = URL.createObjectURL
    const revoke = URL.revokeObjectURL
    URL.createObjectURL = (() => {
      const url = `blob:pending-${created.length}`
      created.push(url)
      return url
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) =>
      revoked.push(url)) as typeof URL.revokeObjectURL
    try {
      const archive = await openImageArchive(archiveFile)
      const pending = archive.getUrl(0)
      const closing = archive.close()
      const [result, closed] = await Promise.allSettled([pending, closing])
      expect(result).toEqual({
        status: 'rejected',
        reason: new Error('ZIPファイルは閉じられています。'),
      })
      expect(closed.status).toBe('fulfilled')
      expect(created).toEqual([])
      expect(revoked).toEqual([])
    } finally {
      URL.createObjectURL = create
      URL.revokeObjectURL = revoke
    }
  })

  test('画像URLをLRU上限内で保持しclose時に解放する', async () => {
    const archiveFile = await makeArchive({
      '1.jpg': 'one',
      '2.jpg': 'two',
      '3.jpg': 'three',
      '4.jpg': 'four',
    })
    const created: string[] = []
    const revoked: string[] = []
    const create = URL.createObjectURL
    const revoke = URL.revokeObjectURL
    URL.createObjectURL = (() => {
      const url = `blob:test-${created.length}`
      created.push(url)
      return url
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = ((url: string) => {
      revoked.push(url)
    }) as typeof URL.revokeObjectURL
    try {
      const archive = await openImageArchive(archiveFile)
      expect(await archive.getUrl(0)).toBe('blob:test-0')
      expect(await archive.getUrl(1)).toBe('blob:test-1')
      expect(await archive.getUrl(2)).toBe('blob:test-2')
      expect(await archive.getUrl(0)).toBe('blob:test-0')
      await archive.getUrl(3)
      expect(revoked).toEqual(['blob:test-1'])
      await archive.close()
      await archive.close()
      expect([...revoked].sort()).toEqual([
        'blob:test-0',
        'blob:test-1',
        'blob:test-2',
        'blob:test-3',
      ])
      await expect(archive.getUrl(4)).rejects.toThrow('閉じられています')
    } finally {
      URL.createObjectURL = create
      URL.revokeObjectURL = revoke
    }
  })
})

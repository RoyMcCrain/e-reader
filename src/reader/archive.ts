import {
  BlobReader,
  BlobWriter,
  ZipReader,
  type FileEntry,
} from '@zip.js/zip.js'

const MAX_ENTRIES = 5000
const MAX_TOTAL = 1_000_000_000
const MAX_IMAGE = 100_000_000
const CACHE_SIZE = 3
const imagePattern = /\.(jpe?g|png|webp|gif|avif|bmp)$/i
const isHiddenPath = (name: string) =>
  name.split('/').some((part) => part === '__MACOSX' || part.startsWith('.'))

export const orderImages = (names: string[]) =>
  names
    .filter((name) => {
      const base = name.split('/').at(-1) ?? ''
      return (
        imagePattern.test(base) && !isHiddenPath(name) && !base.startsWith('._')
      )
    })
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    )

export const openImageArchive = async (file: File) => {
  const reader = new ZipReader(new BlobReader(file))
  let entries
  try {
    entries = await reader.getEntries()
  } catch (error) {
    await reader.close()
    throw error
  }
  if (
    !entries.length ||
    entries.length > MAX_ENTRIES ||
    entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0) > MAX_TOTAL
  ) {
    await reader.close()
    throw new Error('ZIPの項目数または展開サイズが上限を超えています。')
  }
  const names = Object.freeze(
    orderImages(
      entries
        .filter((entry) => !entry.directory)
        .map((entry) => entry.filename),
    ),
  ) as string[]
  if (!names.length) {
    await reader.close()
    throw new Error('画像が見つからないZIPファイルです。')
  }
  const byName = new Map(entries.map((entry) => [entry.filename, entry]))
  const cache = new Map<number, string>()
  const inflight = new Map<number, Promise<string>>()
  let closed = false
  let latestRequestedIndex = -1
  let closePromise: Promise<void> | undefined

  const getUrl = (index: number) => {
    if (closed)
      return Promise.reject(new Error('ZIPファイルは閉じられています。'))
    if (!Number.isInteger(index) || index < 0 || index >= names.length)
      return Promise.reject(new RangeError('画像の番号が範囲外です。'))
    latestRequestedIndex = index
    const cached = cache.get(index)
    if (cached) {
      cache.delete(index)
      cache.set(index, cached)
      return Promise.resolve(cached)
    }
    const pending = inflight.get(index)
    if (pending) return pending
    const entry = byName.get(names[index]) as FileEntry
    if (entry.uncompressedSize > MAX_IMAGE)
      return Promise.reject(new Error('画像が大きすぎます。'))

    const request = (async () => {
      try {
        const blob = await entry.getData(new BlobWriter())
        if (blob.size > MAX_IMAGE) throw new Error('画像が大きすぎます。')
        if (closed) throw new Error('ZIPファイルは閉じられています。')
        const url = URL.createObjectURL(blob)
        cache.set(index, url)
        while (cache.size > CACHE_SIZE) {
          const oldest = [...cache.keys()].find(
            (cachedIndex) => cachedIndex !== latestRequestedIndex,
          ) as number
          URL.revokeObjectURL(cache.get(oldest)!)
          cache.delete(oldest)
        }
        return url
      } finally {
        inflight.delete(index)
      }
    })()
    inflight.set(index, request)
    return request
  }

  const close = () => {
    if (closePromise) return closePromise
    closed = true
    cache.forEach((url) => URL.revokeObjectURL(url))
    cache.clear()
    closePromise = Promise.allSettled([...inflight.values()]).then(() =>
      reader.close(),
    )
    return closePromise
  }
  return { names, getUrl, close }
}

import { expect, test } from '@playwright/test'
import { deflateSync } from 'node:zlib'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const crc32 = (data: Buffer) => {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (name: string, data: Buffer) => {
  const type = Buffer.from(name)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([length, type, data, checksum])
}
const pagePng = (index: number) => {
  const colors = [
    [230, 30, 30],
    [20, 190, 40],
    [20, 40, 220],
    [230, 190, 20],
    [150, 30, 180],
  ]
  const [red, green, blue] = colors[index]
  const row = Buffer.alloc(1 + 400 * 4)
  row[0] = 0
  for (let x = 0; x < 400; x++) {
    const offset = 1 + x * 4
    row[offset] = red
    row[offset + 1] = green
    row[offset + 2] = blue
    row[offset + 3] = 255
  }
  const raw = Buffer.concat(Array.from({ length: 600 }, () => row))
  const header = Buffer.alloc(13)
  header.writeUInt32BE(400, 0)
  header.writeUInt32BE(600, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
const archiveWithPages = async () => {
  const writer = new ZipWriter(new BlobWriter())
  for (let index = 0; index < 5; index++)
    await writer.add(
      `page${index + 1}.png`,
      new Uint8ArrayReader(pagePng(index)),
    )
  return Buffer.from(await (await writer.close()).arrayBuffer())
}

const settings = async (
  page: import('@playwright/test').Page,
  spread: 'auto' | 'single' | 'double',
  margin = 8,
  gutter = 16,
) => {
  await page.addInitScript(
    ({ chosen, margin, gutter }) => {
      localStorage.setItem(
        'shiori.reader.settings.v1',
        JSON.stringify({
          fontFamily: 'publisher',
          fontSize: 18,
          lineHeight: 1.8,
          marginTop: margin,
          marginRight: margin,
          marginBottom: margin,
          marginLeft: margin,
          spread: chosen,
          gutter,
          firstPageSingle: false,
        }),
      )
    },
    { chosen: spread, margin, gutter },
  )
}

const expectImageColor = async (
  page: import('@playwright/test').Page,
  imageNumber: number,
  expected: number[],
) => {
  const color = await page
    .getByRole('img', { name: new RegExp(`画像 ${imageNumber} /`) })
    .evaluate(async (image: HTMLImageElement) => {
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3)
    })
  expect(color).toEqual(expected)
}

const loadBook = async (page: import('@playwright/test').Page) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'layout.zip',
    mimeType: 'application/zip',
    buffer: await archiveWithPages(),
  })
  await expect(page.getByRole('region', { name: '読書画面' })).toBeVisible()
  await expect(page.getByRole('img', { name: /画像 1/ })).toBeVisible()
}

test('cover preference presents only the first ZIP image and returns to ordinary spreads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 850 })
  await loadBook(page)
  await expect(page.getByRole('img', { name: '画像 1 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toHaveCount(0)
  const centers = await page
    .getByRole('img', { name: '画像 1 / 5' })
    .evaluate((image) => {
      const box = image.getBoundingClientRect()
      const stage = document
        .querySelector('[aria-label="読書ページ"]')!
        .getBoundingClientRect()
      return [box.left + box.width / 2, stage.left + stage.width / 2]
    })
  expect(Math.abs(centers[0] - centers[1])).toBeLessThan(3)
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 3 / 5' })).toBeVisible()
  await page.getByRole('button', { name: '前へ' }).click()
  await expect(page.getByRole('img', { name: '画像 1 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toHaveCount(0)
})

test('cover mode does not skip the first body image when enabled on a later spread', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 850 })
  await settings(page, 'double')
  await loadBook(page)
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('img', { name: '画像 3 / 5' })).toBeVisible()
  await page.getByRole('button', { name: '設定' }).click()
  await page
    .getByRole('checkbox', { name: /先頭ページを表紙として1枚表示/ })
    .check()
  await page.getByRole('button', { name: '読書に戻る' }).click()
  await expect(page.getByRole('img', { name: '画像 3 / 5' })).toBeVisible()
  await page.getByRole('button', { name: '前へ' }).click()
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 3 / 5' })).toBeVisible()
  await page.getByRole('button', { name: '前へ' }).click()
  await expect(page.getByRole('img', { name: '画像 1 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toHaveCount(0)
})

test('auto spread responds to content width without changing the current lead', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 850 })
  await settings(page, 'auto', 24, 28)
  await loadBook(page)
  await expect(page.getByRole('img', { name: '画像 1 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toBeVisible()
  await expectImageColor(page, 1, [230, 30, 30])
  await expectImageColor(page, 2, [20, 190, 40])
  await expect(page.getByRole('main', { name: '読書ページ' })).toHaveCSS(
    'padding',
    '24px',
  )
  await expect(page.locator('[class*="imagePair"]')).toHaveCSS('gap', '28px')
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('img', { name: '画像 3 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 4 / 5' })).toBeVisible()
  await expectImageColor(page, 3, [20, 40, 220])
  await expectImageColor(page, 4, [230, 190, 20])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('img', { name: '画像 3 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 4 / 5' })).toHaveCount(0)
  await page.setViewportSize({ width: 768, height: 844 })
  await expect(page.getByRole('img', { name: '画像 3 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 4 / 5' })).toBeVisible()
  await page.setViewportSize({ width: 1100, height: 850 })
  const dimensions = await page
    .getByRole('img', { name: '画像 3 / 5' })
    .evaluate(async (image: HTMLImageElement) => {
      await image.decode()
      return {
        natural: [image.naturalWidth, image.naturalHeight],
        rendered: [
          image.getBoundingClientRect().width,
          image.getBoundingClientRect().height,
        ],
        source: image.currentSrc,
      }
    })
  expect(dimensions.natural).toEqual([400, 600])
  expect(dimensions.source).toContain('blob:')
  expect(dimensions.rendered[0]).toBeGreaterThan(dimensions.natural[0])
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('img', { name: '画像 5 / 5' })).toBeVisible()
  await expect(page.getByRole('button', { name: '次へ' })).toBeDisabled()
  const finalImage = await page
    .getByRole('img', { name: '画像 5 / 5' })
    .evaluate(async (image: HTMLImageElement) => {
      await image.decode()
      return {
        natural: [image.naturalWidth, image.naturalHeight],
        rendered: [
          image.getBoundingClientRect().width,
          image.getBoundingClientRect().height,
        ],
      }
    })
  expect(finalImage.natural).toEqual([400, 600])
  expect(finalImage.rendered[0]).toBeGreaterThan(0)
  await expectImageColor(page, 5, [150, 30, 180])
  const finalBounds = await page
    .getByRole('img', { name: '画像 5 / 5' })
    .evaluate(async (image: HTMLImageElement) => {
      await image.decode()
      const stage = document.querySelector('[aria-label="読書ページ"]')!
      const stageRect = stage.getBoundingClientRect()
      const style = getComputedStyle(stage)
      const width =
        stageRect.width -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight)
      const height =
        stageRect.height -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom)
      const rect = image.getBoundingClientRect()
      const scale = Math.min(
        width / image.naturalWidth,
        height / image.naturalHeight,
      )
      return {
        imageCenter: rect.left + rect.width / 2,
        stageCenter: stageRect.left + parseFloat(style.paddingLeft) + width / 2,
        painted: [image.naturalWidth * scale, image.naturalHeight * scale],
        box: [rect.width, rect.height],
      }
    })
  expect(
    Math.abs(finalBounds.imageCenter - finalBounds.stageCenter),
  ).toBeLessThan(3)
  expect(finalBounds.box[0]).toBeGreaterThanOrEqual(finalBounds.painted[0] - 1)
})

test('physical margins are applied once and determine the auto content-width threshold', async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 844 })
  await settings(page, 'auto', 24)
  await loadBook(page)
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toBeVisible()
  await expect(page.getByRole('main', { name: '読書ページ' })).toHaveCSS(
    'padding',
    '24px',
  )
  await page.evaluate(() => {
    const host = document.querySelector('[aria-label="読書ページ"]')!
    host.setAttribute(
      'style',
      `${host.getAttribute('style')}; padding-left:25px; padding-right:25px`,
    )
  })
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toHaveCount(0)
})

test('rapid turns followed by a resize keep the newest lead', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 850 })
  await settings(page, 'auto')
  await loadBook(page)
  const next = page.getByRole('button', { name: '次へ' })
  await Promise.all([next.click(), next.click()])
  await expect(page.getByRole('img', { name: '画像 5 / 5' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('img', { name: '画像 5 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 4 / 5' })).toHaveCount(0)
  await expect(next).toBeDisabled()
})

test('explicit single and double settings determine image count', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await settings(page, 'double')
  await loadBook(page)
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toBeVisible()
})

test('explicit single mode stays single on a wide screen', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 850 })
  await settings(page, 'single')
  await loadBook(page)
  await expect(page.getByRole('img', { name: '画像 1 / 5' })).toBeVisible()
  await expect(page.getByRole('img', { name: '画像 2 / 5' })).toHaveCount(0)
})

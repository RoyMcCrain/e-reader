import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const forceSingleSpread = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'shiori.reader.settings.v1',
      JSON.stringify({
        fontFamily: 'publisher',
        fontSize: 18,
        lineHeight: 1.8,
        marginTop: 8,
        marginRight: 8,
        marginBottom: 8,
        marginLeft: 8,
        spread: 'single',
        gutter: 16,
      }),
    )
  })
}

const makeArchive = async () => {
  const writer = new ZipWriter(new BlobWriter())
  await writer.add('1.png', new Uint8ArrayReader(Uint8Array.from([1, 2, 3])))
  await writer.add(
    '2.png',
    new Uint8ArrayReader(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
        'base64',
      ),
    ),
  )
  return Buffer.from(await (await writer.close()).arrayBuffer())
}

test('an invalid file keeps its fatal alert and disables navigation', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'invalid.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a valid ZIP'),
  })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(
    page.getByRole('progressbar', { name: '読書の進捗' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: '前へ' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '次へ' })).toBeDisabled()
})

test('a corrupt image alerts but toolbar navigation recovers on a valid page', async ({
  page,
}) => {
  await forceSingleSpread(page)
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'comic.zip',
    mimeType: 'application/zip',
    buffer: await makeArchive(),
  })

  await expect(page.getByRole('alert')).toHaveText(
    '画像を読み込めませんでした。',
  )
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('img', { name: '画像 2 / 2' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '前へ' }).click()
  await expect(page.getByRole('alert')).toHaveText(
    '画像を読み込めませんでした。',
  )
})

test('a delayed page extraction does not animate after settings hide the reader', async ({
  page,
}) => {
  await forceSingleSpread(page)
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer
    let delayNextRead = false
    let releaseRead: (() => void) | undefined
    Object.assign(window, {
      __delayNextZipRead: () => {
        delayNextRead = true
      },
      __releaseZipRead: () => releaseRead?.(),
      __zipReadPending: false,
    })
    Blob.prototype.arrayBuffer = function () {
      const result = read.call(this)
      if (!delayNextRead) return result
      delayNextRead = false
      Object.assign(window, { __zipReadPending: true })
      return new Promise<ArrayBuffer>((resolve, reject) => {
        releaseRead = () => {
          Object.assign(window, { __zipReadPending: false })
          void result.then(resolve, reject)
        }
      })
    }
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const writer = new ZipWriter(new BlobWriter())
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
    'base64',
  )
  await writer.add('1.png', new Uint8ArrayReader(pixel))
  await writer.add('2.png', new Uint8ArrayReader(pixel))
  await page.locator('input[type=file]').setInputFiles({
    name: 'comic.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await (await writer.close()).arrayBuffer()),
  })
  await expect(page.getByRole('img', { name: '画像 1 / 2' })).toBeVisible()
  await page.evaluate(() =>
    (
      window as unknown as { __delayNextZipRead: () => void }
    ).__delayNextZipRead(),
  )
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: 300, y: 400 }],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: 100, y: 400 }],
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __zipReadPending: boolean }).__zipReadPending,
      ),
    )
    .toBe(true)
  await page.waitForTimeout(550)
  await page.getByRole('button', { name: '設定' }).click()
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
  await page.evaluate(() =>
    (window as unknown as { __releaseZipRead: () => void }).__releaseZipRead(),
  )
  await expect(page.locator('img[alt="画像 2 / 2"]')).toBeAttached()
  const reader = page.locator('[aria-hidden="true"] [class*="imagePair"]')
  await expect(reader).toBeAttached()
  expect(await reader.evaluate((pair) => pair.getAnimations().length)).toBe(0)
})

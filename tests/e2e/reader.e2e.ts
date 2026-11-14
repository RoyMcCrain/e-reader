import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

test('landing is usable on desktop and mobile', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: /ページをひらいて/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'ファイルを選ぶ' }),
  ).toBeVisible()
  await expect(
    page.getByText('本のデータはこのブラウザーの外へ送られません。'),
  ).toBeVisible()
})

test('ZIP images turn rapidly in natural order and remain within bounds', async ({
  page,
}) => {
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
    'base64',
  )
  const writer = new ZipWriter(new BlobWriter())
  for (const name of [
    'image10.png',
    'image2.png',
    'image3.png',
    'image4.png',
    'image5.png',
    'image6.png',
  ])
    await writer.add(name, new Uint8ArrayReader(pixel))
  const archive = new Uint8Array(await (await writer.close()).arrayBuffer())
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.locator('input[type=file]').setInputFiles({
    name: 'comic.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(archive),
  })
  await expect(page.getByRole('img', { name: '画像 1 / 6' })).toBeVisible()
  await page.getByRole('button', { name: '次へ' }).click()
  await page.getByRole('button', { name: '前へ' }).click()
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('img', { name: '画像 2 / 6' })).toBeVisible()
  await page.getByRole('button', { name: '次へ' }).click()
  await expect(page.getByRole('img', { name: '画像 3 / 6' })).toBeVisible()
  await page
    .getByRole('main', { name: '読書ページ' })
    .click({ position: { x: 200, y: 200 } })
  for (let turn = 0; turn < 5; turn++) await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('img', { name: '画像 6 / 6' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('img', { name: '画像 6 / 6' })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByRole('img', { name: '画像 6 / 6' })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('img', { name: '画像 5 / 6' })).toBeVisible()
  for (let turn = 0; turn < 3; turn++) await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('img', { name: '画像 2 / 6' })).toBeVisible()
  if ((page.viewportSize()?.width ?? 1280) < 500) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 100, y: 400 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 300, y: 400 }],
    })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect(page.getByRole('img', { name: '画像 1 / 6' })).toBeVisible()
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
    await expect(page.getByRole('img', { name: '画像 2 / 6' })).toBeVisible()
    await cdp.detach()
  }
})

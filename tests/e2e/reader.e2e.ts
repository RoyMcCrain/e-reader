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

test('a ZIP swipe animates the incoming page in its travel direction', async ({
	page,
}) => {
	await forceSingleSpread(page)
	const pixel = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
		'base64',
	)
	const writer = new ZipWriter(new BlobWriter())
	await writer.add('one.png', new Uint8ArrayReader(pixel))
	await writer.add('two.png', new Uint8ArrayReader(pixel))
	const archive = new Uint8Array(await (await writer.close()).arrayBuffer())
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(archive),
	})
	await expect(page.getByRole('img', { name: '画像 1 / 2' })).toBeVisible()
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
	await expect(page.getByRole('img', { name: '画像 2 / 2' })).toBeVisible()
	await expect
		.poll(() =>
			page.locator('[class*="imagePair"]').evaluate((pair) =>
				pair.getAnimations().some((animation) => {
					const frames = (
						animation.effect as KeyframeEffect | null
					)?.getKeyframes()
					const transform = frames?.[0]?.transform
					return (
						typeof transform === 'string' &&
						/translateX\(32px\)/.test(transform)
					)
				}),
			),
		)
		.toBe(true)
	await cdp.detach()
})

test('landing is usable on desktop and mobile', async ({ page }) => {
	await page.goto('/')
	await expect(
		page.getByRole('heading', { name: /ページをひらいて/ }),
	).toBeVisible()
	await expect(
		page.getByRole('button', { name: 'ファイルを選ぶ' }),
	).toBeVisible()
	await expect(
		page.getByText(
			'端末から選んだ本はアップロードされません。クラウドの本は非公開ストレージから読み込みます。',
		),
	).toBeVisible()
})

test('ZIP images turn rapidly and remain within bounds', async ({ page }) => {
	await forceSingleSpread(page)
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

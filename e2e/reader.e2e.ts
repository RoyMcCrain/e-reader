import { expect, test, devices } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

import { expectChromeHiddenImmediately } from './reader-actions'

test.use({ ...devices['Pixel 7'] })

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
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: Buffer.from(archive),
	})
	await expect(page.getByRole('img', { name: '画像 1 / 2' })).toBeVisible()
	await expect(
		page.locator('header', {
			has: page.getByRole('button', { name: '本を閉じる' }),
		}),
	).toHaveCSS('opacity', '1')
	await expect(
		page.locator('footer', {
			has: page.getByRole('progressbar', { name: '読書の進捗' }),
		}),
	).toHaveCSS('opacity', '1')
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
	await Promise.all([
		expectChromeHiddenImmediately(page),
		expect(page.getByRole('img', { name: '画像 2 / 2' })).toBeVisible(),
		expect
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
			.toBe(true),
	])
	await cdp.detach()
})

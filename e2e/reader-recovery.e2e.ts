import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

import { turnPage } from './reader-actions'

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

test('a corrupt image alerts and page input recovers on a valid page', async ({
	page,
}) => {
	await forceSingleSpread(page)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: await makeArchive(),
	})

	await expect(page.getByRole('alert')).toHaveText(
		'画像を読み込めませんでした。',
	)
	await turnPage(page, true)
	await expect(page.getByRole('img', { name: '画像 2 / 2' })).toBeVisible()
	await expect(page.getByRole('alert')).toHaveCount(0)
	await turnPage(page, false)
	await expect(page.getByRole('alert')).toHaveText(
		'画像を読み込めませんでした。',
	)
})

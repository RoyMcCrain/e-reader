import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const bookId = 'a'.repeat(64)
const pixel = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
	'base64',
)

const makeZip = async (names: string[]) => {
	const writer = new ZipWriter(new BlobWriter())
	for (const name of names) await writer.add(name, new Uint8ArrayReader(pixel))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

const routeLibrary = async (
	page: import('@playwright/test').Page,
	archive: Buffer,
) => {
	await page.route('**/api/books**', async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname === '/api/books') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					books: [
						{
							id: bookId,
							name: 'sample-fixture.zip',
							format: 'zip',
							size: archive.length,
						},
					],
				}),
			})
		} else {
			await route.fulfill({
				status: 200,
				contentType: 'application/zip',
				body: archive,
			})
		}
	})
}

test('opens an unassigned private ZIP from its own shelf and keeps settings', async ({
	page,
}) => {
	const archive = await makeZip(['page.png'])
	await routeLibrary(page, archive)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.getByRole('link', { name: /sample-fixture\.zip/ }).click()
	await expect(
		page.getByRole('heading', { level: 1, name: 'シリーズ未設定' }),
	).toBeVisible()
	const seriesUrl = page.url()
	await page.getByRole('button', { name: /sample-fixture\.zip/ }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await page.getByRole('button', { name: '設定' }).click()
	await expect(
		page.getByRole('heading', { name: '表示', exact: true }),
	).toBeVisible()
	await page.getByRole('button', { name: '読書に戻る' }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(page).toHaveURL(seriesUrl)
	await expect(
		page.getByRole('button', { name: /sample-fixture\.zip/ }),
	).toBeVisible()
})

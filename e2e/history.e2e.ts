import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const seriesBooks = [
	{
		id: 'a'.repeat(64),
		name: '巻10.zip',
		format: 'zip',
		size: 10,
		series: '星の旅',
	},
	{
		id: 'b'.repeat(64),
		name: '巻2.zip',
		format: 'zip',
		size: 10,
		series: '星の旅',
	},
]

const standalone = {
	id: 'c'.repeat(64),
	name: '読み切り.zip',
	format: 'zip',
	size: 10,
}

const unread = {
	id: 'd'.repeat(64),
	name: '未読.epub',
	format: 'epub',
	size: 10,
}

const makeZip = async () => {
	const pixel = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
		'base64',
	)
	const writer = new ZipWriter(new BlobWriter())
	await writer.add('page.png', new Uint8ArrayReader(pixel))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

test('history combines series and books in recency order with read dates', async ({
	page,
}) => {
	const archive = await makeZip()
	const books = [
		{ ...seriesBooks[0], size: archive.length },
		{ ...seriesBooks[1], size: archive.length },
		{ ...standalone, size: archive.length },
		unread,
	]
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books }),
		}),
	)
	await page.route('**/api/reading-positions', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				positions: [
					{ bookId: standalone.id, updatedAt: 300 },
					{ bookId: seriesBooks[0]!.id, updatedAt: 100 },
					{ bookId: seriesBooks[1]!.id, updatedAt: 200 },
				],
			}),
		}),
	)
	await page.route('**/api/books/*/cover', (route) =>
		route.fulfill({ status: 404, body: 'Not found' }),
	)
	await page.route('**/api/books/*', async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname.endsWith('/cover'))
			return route.fulfill({ status: 404, body: 'Not found' })
		return route.fulfill({
			status: 200,
			contentType: 'application/zip',
			body: archive,
		})
	})
	await page.goto('/history')
	await expect(
		page.getByRole('heading', { name: '最近読んだ本' }),
	).toBeVisible()
	await expect(page.getByRole('link', { name: '本棚' })).toHaveAttribute(
		'href',
		'/bookshelf',
	)
	const history = page.getByRole('region', { name: '読書履歴' })
	const items = history.getByRole('listitem')
	await expect(items).toHaveCount(2)
	await expect(items.nth(0)).toContainText('読み切り')
	const standaloneTime = items.nth(0).getByRole('time')
	await expect(standaloneTime).toHaveAttribute(
		'datetime',
		new Date(300).toISOString(),
	)
	await expect(items.nth(1)).toContainText('星の旅')
	await expect(items.nth(1)).toContainText('2 冊')
	const seriesTime = items.nth(1).getByRole('time')
	await expect(seriesTime).toHaveAttribute(
		'datetime',
		new Date(200).toISOString(),
	)
	const seriesLink = items
		.nth(1)
		.getByRole('link', { name: /星の旅/ })
		.first()
	await expect(seriesLink).toHaveAttribute(
		'href',
		'/bookshelf/series?name=%E6%98%9F%E3%81%AE%E6%97%85',
	)
	await seriesLink.click()
	await expect(page).toHaveURL(/\/bookshelf\/series\?name=/)
	await expect(
		page.getByRole('heading', { level: 1, name: '星の旅' }),
	).toBeVisible()

	await page.goto('/history')
	const reopened = page
		.getByRole('region', { name: '読書履歴' })
		.getByRole('listitem')
	await reopened
		.nth(0)
		.getByRole('button', { name: /読み切り/ })
		.click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(page).toHaveURL('/history')
})

test('history shows every read book without a limit', async ({ page }) => {
	const many = Array.from({ length: 12 }, (_, index) => ({
		id: index.toString(16).padStart(64, '0'),
		name: `既読 ${index}.epub`,
		format: 'epub',
		size: 10,
	}))
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: many }),
		}),
	)
	await page.route('**/api/reading-positions', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				positions: many.map(({ id }, index) => ({
					bookId: id,
					updatedAt: index + 1,
				})),
			}),
		}),
	)
	await page.route('**/api/books/*/cover', (route) =>
		route.fulfill({ status: 404, body: 'Not found' }),
	)
	await page.goto('/history')
	const items = page
		.getByRole('region', { name: '読書履歴' })
		.getByRole('listitem')
	await expect(items).toHaveCount(12)
	await expect(items.first()).toContainText('既読 11')
	await expect(items.last()).toContainText('既読 0')
})

test('history shows an empty message after a successful position lookup', async ({
	page,
}) => {
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: [] }),
		}),
	)
	await page.route('**/api/reading-positions', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ positions: [] }),
		}),
	)
	await page.goto('/history')
	await expect(page.getByRole('region', { name: '読書履歴' })).toContainText(
		'まだ読んだ本がありません。',
	)
})

test('history retries after a failed position lookup', async ({ page }) => {
	let calls = 0
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: [] }),
		}),
	)
	await page.route('**/api/reading-positions', (route) => {
		calls += 1
		if (calls === 1) return route.fulfill({ status: 500, body: 'unavailable' })
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ positions: [] }),
		})
	})
	await page.goto('/history')
	await expect(page.getByText('読書履歴を取得できませんでした。')).toBeVisible()
	await page.getByRole('button', { name: '再試行' }).click()
	await expect(page.getByRole('region', { name: '読書履歴' })).toContainText(
		'まだ読んだ本がありません。',
	)
})

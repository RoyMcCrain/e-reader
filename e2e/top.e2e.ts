import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const books = Array.from({ length: 12 }, (_, index) => ({
	id: index.toString(16).padStart(64, '0'),
	name: `B${index}.epub`,
	format: 'epub',
	size: 10,
	series: `S${index}`,
	uploadedAt: `2024-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
}))

const mockBooks = async (
	page: import('@playwright/test').Page,
	list: object[],
) => {
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: list }),
		}),
	)
	await page.route('**/api/books/*/cover', (route) =>
		route.fulfill({ status: 404, body: 'Not found' }),
	)
}

test('top previews at most ten new books without a file input', async ({
	page,
}) => {
	await mockBooks(page, books)
	await page.goto('/')
	await expect(page.getByRole('heading', { name: /物語の中へ/ })).toBeVisible()
	await expect(page.locator('input[type=file]')).toHaveCount(0)
	await expect(page.getByRole('link', { name: '本棚を開く' })).toHaveAttribute(
		'href',
		'/bookshelf',
	)
	await expect(
		page.getByRole('link', { name: '最近読んだ本' }),
	).toHaveAttribute('href', '/history')
	await expect(page.getByRole('region', { name: 'シリーズ' })).toHaveCount(0)
	const recent = page.getByRole('region', { name: '新しい本' })
	await expect(recent.getByRole('link', { name: /B11\.epub/ })).toBeVisible()
	await expect(recent.getByRole('link', { name: /B2\.epub/ })).toBeVisible()
	await expect(recent.getByRole('link', { name: /B1\.epub/ })).toHaveCount(0)
	await expect(recent.getByRole('link', { name: /B0\.epub/ })).toHaveCount(0)
})

test('top shows recently read books in recency order capped at ten', async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.setViewportSize({ width: 1280, height: 900 })
	await mockBooks(page, books)
	await page.route('**/api/reading-positions', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				positions: books.map((book, i) => ({
					bookId: book.id,
					updatedAt: (i + 1) * 100,
				})),
			}),
		}),
	)
	await page.goto('/')
	const recent = page.getByRole('region', { name: '最近読んだ本' })
	await expect(recent).toBeVisible()
	await expect(recent.locator('li')).toHaveCount(10)
	await expect(recent.locator('li').first()).toContainText('S11')
	const next = recent.getByRole('button', { name: '最近読んだ本を次へ' })
	const s2 = recent.getByText('S2', { exact: true })
	await expect(s2).not.toBeInViewport()
	await next.click()
	await next.click()
	await expect(s2).toBeInViewport()
	await expect(recent.getByText('S1', { exact: true })).toHaveCount(0)
	await expect(recent.getByText('S0', { exact: true })).toHaveCount(0)
	await expect(
		recent.getByRole('link', { name: 'すべて見る' }),
	).toHaveAttribute('href', '/history')
	await recent.locator('li').first().getByRole('link').first().click()
	await expect(page.getByRole('heading', { name: /S11/ })).toBeVisible()
	await page.getByRole('link', { name: '戻る' }).click()
	expect(new URL(page.url()).pathname).toBe('/')
	await expect(page.getByRole('heading', { name: /物語の中へ/ })).toBeVisible()
})

test('top recovers from a failed book fetch after retry', async ({ page }) => {
	// 初回取得は必ず失敗させ、再試行の直前で成功に切り替える。
	// fetch の到達回数に依存させると、リトライ前の再取得タイミングで結果が変わる。
	let failBooks = true
	await page.route('**/api/books', (route) => {
		if (failBooks) return route.fulfill({ status: 503, body: 'unavailable' })
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: books.slice(0, 1) }),
		})
	})
	await page.route('**/api/books/*/cover', (route) =>
		route.fulfill({ status: 404, body: 'Not found' }),
	)
	await page.goto('/')
	await expect(page.getByText('本は現在利用できません。')).toBeVisible()
	failBooks = false
	await page.getByRole('button', { name: '再試行' }).click()
	await expect(page.getByRole('region', { name: '新しい本' })).toBeVisible()
	await expect(page.getByText('本は現在利用できません。')).toHaveCount(0)
})

test('top renders when reading the mock flag throws a SecurityError', async ({
	page,
}) => {
	await page.addInitScript(() => {
		const getItem = localStorage.getItem.bind(localStorage)
		Storage.prototype.getItem = (key: string) => {
			if (key === 'shiori-mock')
				throw new DOMException('blocked', 'SecurityError')
			return getItem(key)
		}
	})
	await mockBooks(page, books)
	await page.goto('/')
	await expect(page.getByRole('heading', { name: /物語の中へ/ })).toBeVisible()
	await expect(page.getByText('モックを準備しています…')).toHaveCount(0)
})

test('top opens a saved book offline from the later-read section', async ({
	page,
}) => {
	const pixel = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
		'base64',
	)
	const writer = new ZipWriter(new BlobWriter())
	await writer.add('page.png', new Uint8ArrayReader(pixel))
	const archive = Buffer.from(await (await writer.close()).arrayBuffer())
	const saved = {
		id: 'e'.repeat(64),
		name: 'オフライン.zip',
		format: 'zip',
		size: archive.length,
		uploadedAt: '2024-01-01T00:00:00Z',
	}
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: [saved] }),
		}),
	)
	await page.route('**/api/books/*', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/zip',
			body: archive,
		}),
	)
	await page.route('**/api/books/*/cover', (route) =>
		route.fulfill({ status: 404, body: 'Not found' }),
	)
	await page.goto('/bookshelf')
	await page
		.getByRole('button', { name: `${saved.name}を後で読むために保存` })
		.first()
		.click()
	await expect(
		page
			.getByRole('button', { name: `${saved.name}の保存済みを取り消す` })
			.first(),
	).toBeVisible()

	await page.goto('/')
	const offline = page.getByRole('region', { name: '後で読む' })
	const openSaved = offline.getByRole('button', { name: `${saved.name}、ZIP` })
	await openSaved.click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(offline).toBeVisible()

	try {
		await page.context().setOffline(true)
		await page.route('**/api/books/**', (route) => route.abort())
		await openSaved.click()
		await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	} finally {
		await page.context().setOffline(false)
	}
})

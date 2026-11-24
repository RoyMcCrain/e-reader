import { expect, test } from '@playwright/test'

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

test('top previews at most ten series and ten new books without a file input', async ({
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
	const series = page.getByRole('region', { name: 'シリーズ' })
	await expect(series.getByText('S0', { exact: true })).toBeVisible()
	await expect(series.getByText('S9', { exact: true })).toBeVisible()
	await expect(series.getByText('S10', { exact: true })).toHaveCount(0)
	await expect(series.getByText('S11', { exact: true })).toHaveCount(0)
	const recent = page.getByRole('region', { name: '新しい本' })
	await expect(recent.getByRole('link', { name: /B11\.epub/ })).toBeVisible()
	await expect(recent.getByRole('link', { name: /B2\.epub/ })).toBeVisible()
	await expect(recent.getByRole('link', { name: /B1\.epub/ })).toHaveCount(0)
	await expect(recent.getByRole('link', { name: /B0\.epub/ })).toHaveCount(0)
})

test('top recovers from a failed book fetch after retry', async ({ page }) => {
	let calls = 0
	await page.route('**/api/books', (route) => {
		calls += 1
		if (calls <= 2) return route.fulfill({ status: 503, body: 'unavailable' })
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
	await expect(
		page.getByText('クラウドの本は現在利用できません。'),
	).toBeVisible()
	await page.getByRole('button', { name: '再試行' }).click()
	await expect(page.getByRole('region', { name: 'シリーズ' })).toBeVisible()
	await expect(
		page.getByText('クラウドの本は現在利用できません。'),
	).toHaveCount(0)
})

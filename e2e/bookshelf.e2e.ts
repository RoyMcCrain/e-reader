import { expect, test } from '@mizchi/mutator-playwright'
import type { Locator, Page } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

const coverWebp = Buffer.from(
	'UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoCAAMAAgA0JQBOgC6gAP7w6MQh1VpbmxIAAA==',
	'base64',
)

const books = [
	{
		id: 'a'.repeat(64),
		name: '巻10.epub',
		format: 'epub',
		size: 10,
		series: '星の旅',
		uploadedAt: '2024-01-01T00:00:00Z',
		hasCover: true,
	},
	{
		id: 'b'.repeat(64),
		name: '巻2.epub',
		format: 'epub',
		size: 10,
		series: '星の旅',
		uploadedAt: '2024-02-01T00:00:00Z',
	},
	{
		id: 'c'.repeat(64),
		name: '別作品.zip',
		format: 'zip',
		size: 10,
		series: '月の森',
		uploadedAt: '2024-03-01T00:00:00Z',
		hasCover: true,
	},
	{ id: 'd'.repeat(64), name: '未分類.epub', format: 'epub', size: 10 },
]

const makeZip = async () => {
	const pixel = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
		'base64',
	)
	const writer = new ZipWriter(new BlobWriter())
	await writer.add('page.png', new Uint8ArrayReader(pixel))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

// Distance from the scroller's top edge to the element, in CSS pixels.
const topInMain = (locator: Locator) =>
	locator.evaluate((element) => {
		const main = element.closest('main')!
		return Math.round(
			element.getBoundingClientRect().top - main.getBoundingClientRect().top,
		)
	})

const isSeriesReturn = (url: URL, name: string) =>
	url.pathname === '/bookshelf' &&
	url.searchParams.get('from') === 'series' &&
	url.searchParams.get('name') === name

const shelfLink = (page: Page, name: string) =>
	page
		.getByRole('region', { name: 'すべての本' })
		.getByRole('link', { name, exact: true })
const openSeries = async (page: Page, name: string) => {
	await shelfLink(page, name).click()
	await expect(
		page.getByRole('heading', { level: 1, name, exact: true }),
	).toBeVisible()
}

// Synthetic shelf with one single-volume series per group, named by number.
const numberedSeries = (length: number) =>
	Array.from({ length }, (_, index) => ({
		id: (index + 1).toString(16).padStart(64, '0'),
		name: '第1巻.epub',
		format: 'epub',
		size: 10,
		series: `シリーズ${String(index + 1).padStart(2, '0')}`,
		uploadedAt: '2024-01-01T00:00:00Z',
	}))

// Shelf covers in every sort mode are links to the series detail.
const coverLinks = (region: Locator) =>
	region.getByRole('link', { name: /、(EPUB|ZIP)$/ })

const mockLibrary = async (
	page: Page,
	list: object[],
	archive?: Buffer,
	positions: object[] = [],
) => {
	const requests = { books: 0 }
	await page.route('**/api/reading-positions', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ positions }),
		}),
	)
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: list }),
		}),
	)
	await page.route('**/api/books/**', async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname.endsWith('/cover'))
			return route.fulfill({ status: 404, body: 'Not found' })
		requests.books += 1
		if (!archive)
			return route.fulfill({ status: 500, body: 'unexpected book request' })
		return route.fulfill({
			status: 200,
			contentType: 'application/zip',
			body: archive,
		})
	})
	return requests
}

test('bookshelf filters, groups, orders and fits mobile width', async ({
	page,
}) => {
	const coverRequests: string[] = []
	let bookRequests = 0
	await page.route('**/api/reading-positions', async (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				positions: [
					{ bookId: books[2]!.id, updatedAt: 200 },
					{ bookId: books[1]!.id, updatedAt: 100 },
					...Array.from({ length: 10 }, (_, index) => ({
						bookId: `${index}`.repeat(64),
						updatedAt: 300 - index,
					})),
				],
			}),
		}),
	)
	await page.route('**/api/books', async (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books }),
		}),
	)
	await page.route('**/api/books/**', async (route) => {
		bookRequests += 1
		await route.fulfill({ status: 500, body: 'unexpected book request' })
	})
	await page.route('**/api/books/*/cover', async (route) => {
		const id = new URL(route.request().url()).pathname.split('/')[3]
		coverRequests.push(id)
		if (id === 'a'.repeat(64))
			return route.fulfill({
				status: 200,
				contentType: 'image/webp',
				body: coverWebp,
			})
		return route.fulfill({ status: 404, body: 'Not found' })
	})
	await page.goto('/bookshelf')
	await expect(page.getByRole('heading', { name: '本棚' })).toBeVisible()
	const footer = page.getByRole('contentinfo', {
		name: '本棚の絞り込みと表示設定',
	})
	const searchToggle = page.getByRole('button', { name: '検索', exact: true })
	const searchInput = page.getByLabel('タイトル・シリーズで検索')
	await expect(searchToggle).toBeVisible()
	await expect(searchInput).toBeHidden()
	await expect(footer.getByLabel('形式')).toBeVisible()
	await expect(footer.getByLabel('表示順')).toBeVisible()
	await expect(footer.getByRole('searchbox')).toHaveCount(0)
	await expect(searchToggle).toHaveAttribute('aria-expanded', 'false')
	await searchToggle.click()
	await expect(searchToggle).toHaveAttribute('aria-expanded', 'true')
	await expect(searchInput).toBeVisible()
	await expect(searchInput).toBeFocused()
	await expect(page.getByRole('region', { name: '最近読んだ本' })).toHaveCount(
		0,
	)
	await expect(page.getByRole('link', { name: '履歴' })).toHaveAttribute(
		'href',
		'/history',
	)
	const all = page.getByRole('region', { name: 'すべての本' })
	const allBox = await all.boundingBox()
	const uploadBox = await page
		.getByRole('region', { name: '最近アップロードされた本' })
		.boundingBox()
	expect(allBox).not.toBeNull()
	expect(uploadBox).not.toBeNull()
	expect(allBox!.y).toBeLessThan(uploadBox!.y)
	const seriesHeading = all.getByRole('heading', { name: /星の旅/ })
	await expect(
		seriesHeading.getByRole('link', { name: /星の旅/ }),
	).toHaveAttribute(
		'href',
		'/bookshelf/series?name=%E6%98%9F%E3%81%AE%E6%97%85&from=%2Fbookshelf',
	)
	const row = all.getByRole('list', { name: '星の旅の本' })
	const volumes = row.getByRole('link')
	await expect(volumes).toHaveCount(2)
	await expect(volumes.nth(0)).toHaveAccessibleName(/巻2/)
	await expect(volumes.nth(1)).toHaveAccessibleName(/巻10/)
	await expect(
		all.getByRole('heading', { name: /シリーズ未設定/ }),
	).toBeVisible()
	await expect(all.getByRole('heading', { level: 3 })).toHaveText([
		/月の森/,
		/星の旅/,
		/シリーズ未設定/,
	])

	const recent = page.getByRole('region', { name: '最近アップロードされた本' })
	const recentBooks = recent.getByRole('button', { name: /、(EPUB|ZIP)$/ })
	await expect(recentBooks).toHaveCount(3)
	await expect(page.getByLabel('シリーズ', { exact: true })).toHaveCount(0)
	await expect(recentBooks.nth(0)).toHaveAccessibleName(/別作品/)
	await expect(recentBooks.nth(1)).toHaveAccessibleName(/巻2/)
	await expect(recentBooks.nth(2)).toHaveAccessibleName(/巻10/)
	await expect(recent.getByRole('button', { name: /未分類/ })).toHaveCount(0)

	const loadedCover = page
		.locator(`img[src="/api/books/${'a'.repeat(64)}/cover"]`)
		.first()
	await expect(loadedCover).toHaveCSS('opacity', '1')
	await expect
		.poll(() =>
			loadedCover.evaluate((img: HTMLImageElement) => img.naturalWidth),
		)
		.toBe(2)
	const failedCover = all
		.getByRole('link', { name: /別作品/ })
		.locator(`img[src="/api/books/${'c'.repeat(64)}/cover"]`)
	await expect(failedCover).toHaveCSS('opacity', '0')
	await expect(
		all
			.getByRole('link', { name: /別作品/ })
			.getByText('別作品', { exact: true }),
	).toBeVisible()
	await expect(
		all.getByRole('link', { name: /未分類/ }).locator('img'),
	).toHaveCount(1)
	await expect.poll(() => new Set(coverRequests).size).toBe(4)
	expect(new Set(coverRequests)).toEqual(
		new Set(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]),
	)
	expect(bookRequests).toBe(0)

	await page.getByLabel('タイトル・シリーズで検索').fill('月の')
	await expect(coverLinks(all)).toHaveCount(1)
	await page.getByLabel('形式').selectOption('zip')
	await expect(coverLinks(all)).toHaveCount(1)
	await expect(coverLinks(all)).toHaveAccessibleName(/別作品/)
	await page.getByLabel('タイトル・シリーズで検索').fill('星の旅')
	await expect(all.getByText('条件に合う本はありません。')).toBeVisible()
	await page.getByRole('button', { name: '条件をクリア' }).click()
	await expect(coverLinks(all)).toHaveCount(4)
	await page.getByLabel('表示順').selectOption('newest')
	const ordered = coverLinks(all)
	await expect(ordered.nth(0)).toHaveAccessibleName(/別作品/)
	await expect(ordered.nth(1)).toHaveAccessibleName(/巻2/)
	await expect(ordered.nth(2)).toHaveAccessibleName(/巻10/)
	await expect(ordered.nth(3)).toHaveAccessibleName(/未分類/)
	await page.getByLabel('タイトル・シリーズで検索').fill('存在しない本')
	await expect(all.getByText('条件に合う本はありません。')).toBeVisible()
	await searchToggle.click()
	await expect(searchInput).toBeHidden()
	await expect(all.getByText('条件に合う本はありません。')).toBeVisible()
	await searchToggle.click()
	await expect(searchInput).toHaveValue('存在しない本')
	await searchToggle.click()
	await page.getByRole('button', { name: '条件をクリア' }).click()
	await expect(coverLinks(all)).toHaveCount(4)
	await expect(page.getByRole('button', { name: '条件をクリア' })).toBeHidden()
	await searchToggle.click()
	await expect(searchInput).toBeVisible()
	await expect(searchInput).toHaveValue('')

	await page.setViewportSize({ width: 320, height: 844 })
	const toggleBox = await searchToggle.boundingBox()
	expect(toggleBox).not.toBeNull()
	expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(320)

	await page.setViewportSize({ width: 390, height: 844 })
	await expect(searchToggle).toBeVisible()
	await expect(searchInput).toBeVisible()
	const recentCard = await recentBooks.first().boundingBox()
	expect(recentCard).not.toBeNull()
	expect(recentCard!.width).toBeGreaterThanOrEqual(140)
	expect(recentCard!.width).toBeLessThanOrEqual(220)
	const thirdCard = await recentBooks.nth(2).boundingBox()
	expect(thirdCard).not.toBeNull()
	expect(thirdCard!.y).toBeCloseTo(recentCard!.y, 0)
	const recentTrack = await recent
		.getByRole('list', { name: '最近アップロードされた本の一覧' })
		.evaluate((track: HTMLElement) => ({
			client: track.clientWidth,
			scroll: track.scrollWidth,
		}))
	expect(recentTrack.scroll > recentTrack.client).toBe(true)
	const dimensions = await page.evaluate(() => ({
		client: document.documentElement.clientWidth,
		scroll: document.documentElement.scrollWidth,
	}))
	expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
	const searchField = page.getByLabel('タイトル・シリーズで検索')
	await searchField.fill('巻')
	await page.getByLabel('形式').selectOption('epub')
	await page.getByLabel('表示順').selectOption('newest')
	await page.setViewportSize({ width: 720, height: 748 })
	await expect(
		recent.getByRole('button', { name: /、(EPUB|ZIP)$/ }),
	).toHaveCount(2)
	// 収まりきる場合も前へ／次へは常時表示され、無効状態になる。
	for (const name of [
		'最近アップロードされた本を前へ',
		'最近アップロードされた本を次へ',
	] as const) {
		await expect(recent.getByRole('button', { name })).toBeVisible()
		await expect(recent.getByRole('button', { name })).toBeDisabled()
	}
	for (const name of ['すべての本を前へ', 'すべての本を次へ'] as const) {
		await expect(all.getByRole('button', { name })).toBeVisible()
		await expect(all.getByRole('button', { name })).toBeDisabled()
	}
	await expect(coverLinks(all)).toHaveCount(2)
	const firstResult = await ordered.nth(0).boundingBox()
	const secondResult = await ordered.nth(1).boundingBox()
	expect(firstResult).not.toBeNull()
	expect(secondResult).not.toBeNull()
	expect(secondResult!.y).toBeCloseTo(firstResult!.y, 0)
	await expect(searchField).toHaveValue('巻')
	await page.setViewportSize({ width: 390, height: 844 })
	await expect(searchField).toHaveValue('巻')
	await expect(page.getByLabel('形式')).toHaveValue('epub')
	await expect(page.getByLabel('表示順')).toHaveValue('newest')
	await expect(coverLinks(all)).toHaveCount(2)
	await page.getByRole('button', { name: '条件をクリア' }).click()
	await page.getByLabel('表示順').selectOption('series')
	await expect(coverLinks(all)).toHaveCount(4)
	await page.getByRole('main').evaluate((main) => {
		main.scrollTop = main.scrollHeight
	})
	const footerBox = await footer.boundingBox()
	const mainBox = await page.getByRole('main').boundingBox()
	const lastBookBox = await all
		.getByRole('link', { name: /未分類/ })
		.boundingBox()
	expect(footerBox).not.toBeNull()
	expect(mainBox).not.toBeNull()
	expect(lastBookBox).not.toBeNull()
	expect(footerBox!.y + footerBox!.height).toBeCloseTo(844, 0)
	expect(lastBookBox!.y + lastBookBox!.height).toBeLessThanOrEqual(
		footerBox!.y + 1,
	)
	expect(mainBox!.y + mainBox!.height).toBeLessThanOrEqual(footerBox!.y + 1)
})

test('keeps a long series in one scrollable carousel row at phone width', async ({
	page,
}) => {
	const seriesName = '長いシリーズ名'.repeat(6)
	const volumes = Array.from({ length: 8 }, (_, index) => ({
		id: `${index}`.repeat(64),
		name: `連作 ${index + 1}.epub`,
		format: 'epub',
		size: 10,
		series: seriesName,
	}))
	await mockLibrary(page, volumes)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/bookshelf')
	const row = page.getByRole('list', { name: `${seriesName}の本` })
	await expect(row.getByRole('link')).toHaveCount(8)
	const first = await row.getByRole('link').first().boundingBox()
	const last = await row.getByRole('link').last().boundingBox()
	expect(first).not.toBeNull()
	expect(last).not.toBeNull()
	expect(last!.y).toBeCloseTo(first!.y, 0)
	const overflows = await row.evaluate(
		(track) => track.scrollWidth > track.clientWidth,
	)
	expect(overflows).toBe(true)
	const dimensions = await page.evaluate(() => ({
		client: document.documentElement.clientWidth,
		scroll: document.documentElement.scrollWidth,
	}))
	expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
	const previous = page.getByRole('button', { name: `${seriesName}を前へ` })
	const next = page.getByRole('button', { name: `${seriesName}を次へ` })
	await expect(previous).toBeDisabled()
	await next.click()
	await expect(previous).toBeEnabled()
	await previous.click()
	await expect(previous).toBeDisabled()
	await expect(
		page.getByRole('heading', { name: seriesName }).getByRole('link'),
	).toBeVisible()
})

test('series detail keeps exact names, volumes and reader return through direct URLs', async ({
	page,
}) => {
	const archive = await makeZip()
	const seriesName = 'A/B #?% 星'
	const shelf = [
		{
			id: '1'.repeat(64),
			name: '巻10.zip',
			format: 'zip',
			size: archive.length,
			series: seriesName,
			author: '星野 文',
		},
		{
			id: '2'.repeat(64),
			name: '巻2.zip',
			format: 'zip',
			size: archive.length,
			series: seriesName,
			author: '星野 文',
		},
		{
			id: '3'.repeat(64),
			name: '別作品.zip',
			format: 'zip',
			size: archive.length,
			series: '月の森',
			author: '別の著者',
		},
	]
	const requests = await mockLibrary(page, shelf, archive)
	await page.goto('/bookshelf')
	await page.getByRole('button', { name: '検索', exact: true }).click()
	await page.getByLabel('タイトル・シリーズで検索').fill('巻2')
	const all = page.getByRole('region', { name: 'すべての本' })
	await expect(coverLinks(all)).toHaveCount(1)
	await coverLinks(all).click()

	await expect(page).toHaveURL(/\/bookshelf\/series\?name=/)
	const detailUrl = page.url()
	const parsed = new URL(detailUrl)
	expect(parsed.pathname).toBe('/bookshelf/series')
	expect(parsed.searchParams.get('name')).toBe(seriesName)
	await expect(
		page.getByRole('heading', { level: 1, name: seriesName, exact: true }),
	).toBeVisible()
	await expect(page.getByText('著者: 星野 文', { exact: true })).toBeVisible()
	await expect(page.getByText('別の著者')).toHaveCount(0)
	const list = page.getByRole('list', { name: `${seriesName}の収録本` })
	await expect(list.getByRole('button')).toHaveCount(2)
	await expect(list.getByRole('button').nth(0)).toHaveAccessibleName(/巻2/)
	await expect(list.getByRole('button').nth(1)).toHaveAccessibleName(/巻10/)
	await expect.poll(() => requests.books).toBe(0)

	await list.getByRole('button', { name: /巻2/ }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await expect(
		page.getByRole('heading', { level: 1, name: seriesName }),
	).toBeHidden()
	await expect.poll(() => requests.books).toBe(1)
	await page.getByRole('button', { name: '設定' }).click()
	await expect(
		page.getByRole('heading', { name: '表示', exact: true }),
	).toBeVisible()
	await page.getByRole('button', { name: '読書に戻る' }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(page).toHaveURL(detailUrl)

	await page.goto(detailUrl)
	await expect(
		page.getByRole('heading', { level: 1, name: seriesName, exact: true }),
	).toBeVisible()
	await expect(
		page
			.getByRole('list', { name: `${seriesName}の収録本` })
			.getByRole('button'),
	).toHaveCount(2)
	await page.getByRole('link', { name: '戻る' }).click()
	await expect(page).toHaveURL((url) => isSeriesReturn(url, seriesName))
	await expect(page.getByRole('heading', { name: '本棚' })).toBeVisible()

	await page.goto('/bookshelf/series?name=' + encodeURIComponent('存在しない'))
	await expect(
		page.getByText('このシリーズの本は見つかりません。'),
	).toBeVisible()
	const missingHref = await page
		.getByRole('link', { name: '戻る' })
		.getAttribute('href')
	const missingBack = new URL(missingHref!, page.url())
	expect(missingBack.pathname).toBe('/bookshelf')
	expect(missingBack.searchParams.get('from')).toBe('series')
	expect(missingBack.searchParams.get('name')).toBe('存在しない')

	await page.goto('/bookshelf/series')
	await expect(
		page.getByRole('heading', {
			level: 1,
			name: 'シリーズ未設定',
			exact: true,
		}),
	).toBeVisible()
	await expect(page.getByRole('link', { name: '戻る' })).toHaveAttribute(
		'href',
		'/bookshelf?from=series',
	)
})

test('bookshelf omits the recently-read shelf and links to the history page', async ({
	page,
}) => {
	const recentBooks = Array.from({ length: 10 }, (_, index) => ({
		id: index.toString(16).padStart(64, '0'),
		name: `既読 ${index}.epub`,
		format: 'epub',
		size: 10,
	}))
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: recentBooks }),
		}),
	)
	await page.route('**/api/reading-positions', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				positions: recentBooks.map(({ id }, index) => ({
					bookId: id,
					updatedAt: index + 1,
				})),
			}),
		}),
	)
	await page.route('**/api/books/*/cover', (route) =>
		route.fulfill({ status: 404, body: 'Not found' }),
	)
	await page.goto('/bookshelf')
	await expect(page.getByRole('region', { name: '最近読んだ本' })).toHaveCount(
		0,
	)
	await expect(page.getByRole('link', { name: '履歴' })).toHaveAttribute(
		'href',
		'/history',
	)
	const all = page.getByRole('region', { name: 'すべての本' })
	await expect(
		all.getByRole('list', { name: 'シリーズ未設定の本' }).getByRole('link'),
	).toHaveCount(10)
})

test('series detail shows the last read volume and resumes it in the reader', async ({
	page,
}) => {
	await page.setViewportSize({ width: 320, height: 640 })
	const archive = await makeZip()
	const seriesName = '星の旅'
	const latestName = `巻10-${'x'.repeat(120)}.zip`
	const shelf = [
		{
			id: '1'.repeat(64),
			name: latestName,
			format: 'zip',
			size: archive.length,
			series: seriesName,
		},
		{
			id: '2'.repeat(64),
			name: '巻2.zip',
			format: 'zip',
			size: archive.length,
			series: seriesName,
		},
		{
			id: '3'.repeat(64),
			name: '別作品.zip',
			format: 'zip',
			size: archive.length,
			series: '月の森',
		},
	]
	const positions = [
		{ bookId: '2'.repeat(64), updatedAt: 1_767_225_600 },
		{ bookId: '1'.repeat(64), updatedAt: 1_767_229_200 },
		{ bookId: '3'.repeat(64), updatedAt: 1_767_232_800 },
	]
	await mockLibrary(page, shelf, archive, positions)
	await page.goto(`/bookshelf/series?name=${encodeURIComponent(seriesName)}`)
	const resume = page.getByRole('button', { name: `続きを読む、${latestName}` })
	await expect(resume).toBeVisible()
	const widths = await page.evaluate(() => ({
		scroll: document.documentElement.scrollWidth,
		client: document.documentElement.clientWidth,
	}))
	expect(widths.scroll).toBeLessThanOrEqual(widths.client)
	await expect(page.getByText('別作品')).toHaveCount(0)
	const list = page.getByRole('list', { name: `${seriesName}の収録本` })
	const current = list.locator('li[aria-current="true"]')
	await expect(current).toHaveCount(1)
	await expect(current).toContainText('巻10')
	await resume.click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()

	// Reading another volume elsewhere, then closing the reader, refreshes the mark.
	positions[0] = { bookId: '2'.repeat(64), updatedAt: 1_767_240_000 }
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(
		page.getByRole('button', { name: '続きを読む、巻2.zip' }),
	).toBeVisible()
	await expect(current).toContainText('巻2')
})

test('series return scrolls the shelf group to the top after groups shift above it', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 640 })
	const shelf = numberedSeries(8)
	await mockLibrary(page, shelf)
	await page.goto('/bookshelf')
	const scroller = page.getByRole('main')
	const target = shelfLink(page, 'シリーズ04')
	await expect(target).toBeVisible()
	// Move the target heading down to roughly 240px below the scroller top.
	const offset = await topInMain(target)
	await scroller.evaluate((main, shift) => {
		main.scrollTop += shift
	}, offset - 240)
	await expect.poll(() => topInMain(target)).toBeGreaterThan(120)

	await target.click()
	await expect(
		page.getByRole('heading', { level: 1, name: 'シリーズ04', exact: true }),
	).toBeVisible()
	// Two volumes sorting before the target push its group down while away.
	shelf.push(
		...['00 追加1', '00 追加2'].map((series, index) => ({
			id: (index + 100).toString(16).padStart(64, '0'),
			name: '追加.epub',
			format: 'epub',
			size: 10,
			series,
			uploadedAt: '2024-01-01T00:00:00Z',
		})),
	)

	await page.getByRole('link', { name: '戻る' }).click()
	await expect(target).toBeInViewport()
	await expect.poll(() => topInMain(target)).toBeLessThanOrEqual(24)
	await expect(page).toHaveURL((url) => isSeriesReturn(url, 'シリーズ04'))

	await page.goto('/bookshelf')
	await expect(target).toBeVisible()
	await expect
		.poll(() => scroller.evaluate((element) => element.scrollTop))
		.toBe(0)
})

test('explicit series return scrolls only the shelf and keeps the resume card in the outer page', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 640 })
	await page.addInitScript(() =>
		localStorage.setItem(
			'shiori.reader.last-session.v1',
			JSON.stringify({
				bookId: 'f'.repeat(64),
				name: '読みかけ.epub',
				format: 'epub',
				updatedAt: 1,
			}),
		),
	)
	await mockLibrary(page, numberedSeries(9))
	await page.goto('/bookshelf/series?name=' + encodeURIComponent('シリーズ05'))
	const resume = page.getByRole('region', { name: '前回の続き' })
	await expect(resume).toBeInViewport()
	await page.getByRole('link', { name: '戻る' }).click()
	await expect(shelfLink(page, 'シリーズ05')).toBeInViewport()
	await expect(resume).toBeInViewport()
	expect(await page.evaluate(() => window.scrollY)).toBe(0)
	await expect
		.poll(() => page.getByRole('main').evaluate((main) => main.scrollTop))
		.toBeGreaterThan(0)
})

test('native back scrolls to the series last opened from that shelf entry', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 640 })
	await mockLibrary(page, numberedSeries(9))
	await page.goto('/bookshelf')
	await openSeries(page, 'シリーズ02')
	await page.getByRole('link', { name: '戻る' }).click()
	await expect(shelfLink(page, 'シリーズ02')).toBeInViewport()
	await openSeries(page, 'シリーズ07')
	await page.goBack()
	await expect(shelfLink(page, 'シリーズ07')).toBeInViewport()
	await expect(shelfLink(page, 'シリーズ02')).not.toBeInViewport()

	// A normal shelf entry (no return URL) scrolls on its first native back.
	await page.goto('/bookshelf')
	await openSeries(page, 'シリーズ09')
	await page.goBack()
	await expect(shelfLink(page, 'シリーズ09')).toBeInViewport()
})

test('bookshelf renders when the position lookup fails', async ({ page }) => {
	const shelfBook = {
		id: 'e'.repeat(64),
		name: '棚の本.epub',
		format: 'epub',
		size: 10,
	}
	await page.route('**/api/books', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ books: [shelfBook] }),
		}),
	)
	await page.route('**/api/reading-positions', (route) =>
		route.fulfill({ status: 500, body: 'unavailable' }),
	)
	await page.route('**/api/books/*/cover', (route) =>
		route.fulfill({ status: 404, body: 'Not found' }),
	)
	await page.goto('/bookshelf')
	await expect(page.getByRole('region', { name: '最近読んだ本' })).toHaveCount(
		0,
	)
	await expect(page.getByRole('region', { name: 'すべての本' })).toBeVisible()
	await expect(
		page.getByRole('region', { name: '最近アップロードされた本' }),
	).toBeVisible()
})

test('recently uploaded covers open the reader directly and close back to the shelf', async ({
	page,
}) => {
	const archive = await makeZip()
	const requests = await mockLibrary(
		page,
		[{ ...books[2], size: archive.length }],
		archive,
	)
	await page.goto('/bookshelf')
	const recent = page.getByRole('region', { name: '最近アップロードされた本' })
	const footer = page.getByRole('contentinfo', {
		name: '本棚の絞り込みと表示設定',
	})
	await recent.getByRole('button', { name: '別作品.zip、ZIP' }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await expect(footer).toBeHidden()
	await expect(page.getByRole('region', { name: 'すべての本' })).toHaveCount(0)
	await expect.poll(() => requests.books).toBe(1)
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(page).toHaveURL('/bookshelf')
	await expect(page.getByRole('heading', { name: '本棚' })).toBeVisible()
	await expect(footer).toBeVisible()
})

test('long shelf returns to the top with a back-to-top button at phone width', async ({
	page,
}) => {
	const shelf = Array.from({ length: 48 }, (_, index) => ({
		id: (index + 1).toString(16).padStart(64, '0'),
		name: `第${(index % 3) + 1}巻.epub`,
		format: 'epub',
		size: 10,
		series: `長いシリーズ${Math.floor(index / 3) + 1}`,
		uploadedAt: '2024-01-01T00:00:00Z',
	}))
	await mockLibrary(page, shelf)
	await page.setViewportSize({ width: 390, height: 844 })
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await page.goto('/bookshelf')
	const scroller = page.getByRole('main')
	const backToTop = page.getByRole('button', { name: '先頭へ戻る' })
	const heading = page.getByRole('heading', { name: '本棚', exact: true })
	const footer = page.getByRole('contentinfo', {
		name: '本棚の絞り込みと表示設定',
	})
	await expect(footer).toBeVisible()
	await expect(backToTop).toBeHidden()

	await scroller.evaluate((element) => {
		element.scrollTop = element.scrollHeight
	})
	await expect(backToTop).toBeVisible()
	const footerBox = await footer.boundingBox()
	const buttonBox = await backToTop.boundingBox()
	expect(footerBox).not.toBeNull()
	expect(buttonBox).not.toBeNull()
	expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(footerBox!.y)

	const url = page.url()
	await backToTop.click()
	await expect
		.poll(() => scroller.evaluate((element) => element.scrollTop))
		.toBe(0)
	await expect(heading).toBeInViewport()
	await expect(backToTop).toBeHidden()
	await expect(scroller).toBeFocused()
	expect(page.url()).toBe(url)
})

test('offline saves open from the shelf without network', async ({ page }) => {
	const archive = await makeZip()
	const book = {
		id: 'f'.repeat(64),
		name: 'オフライン.zip',
		format: 'zip',
		size: archive.length,
		uploadedAt: '2024-01-01T00:00:00Z',
	}
	await mockLibrary(page, [book], archive)
	await page.goto('/bookshelf')
	const saveName = `${book.name}を後で読むために保存`
	const savedName = `${book.name}の保存済みを取り消す`
	// すべての本と最近アップロードの両方に保存ボタンが出る。
	await expect(page.getByRole('button', { name: saveName })).toHaveCount(2)
	await page.getByRole('button', { name: saveName }).first().click()
	await expect(page.getByRole('button', { name: savedName })).toHaveCount(2)
	const shelf = page.getByRole('region', { name: '後で読む' })
	await expect(shelf).toBeVisible()

	// 本棚の絞り込みは後で読むにも連動する。
	await page.getByRole('button', { name: '検索', exact: true }).click()
	await page.getByLabel('タイトル・シリーズで検索').fill('存在しない本')
	await expect(shelf).toHaveCount(0)
	await page.getByRole('button', { name: '条件をクリア' }).click()
	await expect(shelf).toBeVisible()

	try {
		await page.context().setOffline(true)
		await page.route('**/api/books/**', (route) => route.abort())
		await shelf.getByRole('button', { name: `${book.name}、ZIP` }).click()
		await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
		await page.getByRole('button', { name: '本を閉じる' }).click()
		await expect(page.getByRole('heading', { name: '本棚' })).toBeVisible()
	} finally {
		await page.context().setOffline(false)
	}

	// 削除すると棚が消え、両方の保存ボタンが元に戻る。
	await shelf
		.getByRole('button', { name: `${book.name}を後で読むから削除` })
		.click()
	await expect(shelf).toHaveCount(0)
	await expect(page.getByRole('button', { name: saveName })).toHaveCount(2)
})

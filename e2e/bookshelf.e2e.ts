import { expect, test } from '@mizchi/mutator-playwright'
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

test('bookshelf filters, groups, orders and fits mobile width', async ({
	page,
}) => {
	const coverRequests: string[] = []
	let bookRequests = 0
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
	const all = page.getByRole('region', { name: 'すべての本' })
	const seriesHeading = all.getByRole('heading', { name: /星の旅/ })
	const group = seriesHeading.locator('..')
	const volumes = group.getByRole('button')
	await expect(volumes).toHaveCount(2)
	await expect(volumes.nth(0)).toHaveAccessibleName(/巻2/)
	await expect(volumes.nth(1)).toHaveAccessibleName(/巻10/)
	await expect(
		all.getByRole('heading', { name: 'シリーズ未設定' }),
	).toBeVisible()

	const recent = page.getByRole('region', { name: '最近アップロードされた本' })
	const recentBooks = recent.getByRole('button')
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
		.getByRole('button', { name: /別作品/ })
		.locator(`img[src="/api/books/${'c'.repeat(64)}/cover"]`)
	await expect(failedCover).toHaveCSS('opacity', '0')
	await expect(
		all
			.getByRole('button', { name: /別作品/ })
			.getByText('別作品', { exact: true }),
	).toBeVisible()
	await expect(
		all.getByRole('button', { name: /未分類/ }).locator('img'),
	).toHaveCount(0)
	await expect.poll(() => new Set(coverRequests).size).toBe(2)
	expect(new Set(coverRequests)).toEqual(
		new Set(['a'.repeat(64), 'c'.repeat(64)]),
	)
	expect(bookRequests).toBe(0)

	await page.getByLabel('タイトル・シリーズで検索').fill('月の')
	await expect(all.getByRole('button')).toHaveCount(1)
	await page.getByLabel('形式').selectOption('zip')
	await expect(all.getByRole('button')).toHaveCount(1)
	await expect(all.getByRole('button')).toHaveAccessibleName(/別作品/)
	await page.getByLabel('タイトル・シリーズで検索').fill('星の旅')
	await expect(all.getByText('条件に合う本はありません。')).toBeVisible()
	await page.getByRole('button', { name: '条件をクリア' }).click()
	await expect(all.getByRole('button')).toHaveCount(4)
	await page.getByLabel('表示順').selectOption('newest')
	const ordered = all.getByRole('button')
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
	await expect(all.getByRole('button')).toHaveCount(4)
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
	const wrappedCard = await recentBooks.nth(2).boundingBox()
	expect(wrappedCard).not.toBeNull()
	expect(wrappedCard!.y).toBeGreaterThan(recentCard!.y + recentCard!.height)
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
	await expect(recent.getByRole('button')).toHaveCount(2)
	await expect(all.getByRole('button')).toHaveCount(2)
	const recentPane = await recent.boundingBox()
	const allPane = await all.boundingBox()
	expect(recentPane).not.toBeNull()
	expect(allPane).not.toBeNull()
	expect(allPane!.x).toBeGreaterThan(recentPane!.x + recentPane!.width)
	const recentTitle = await recent
		.getByRole('heading', { name: '最近アップロードされた本' })
		.boundingBox()
	const allTitle = await all
		.getByRole('heading', { name: 'すべての本' })
		.boundingBox()
	expect(recentTitle).not.toBeNull()
	expect(allTitle).not.toBeNull()
	expect(Math.abs(allTitle!.y - recentTitle!.y)).toBeLessThan(2)
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
	await expect(all.getByRole('button')).toHaveCount(2)
	await page.getByRole('button', { name: '条件をクリア' }).click()
	await page.getByLabel('表示順').selectOption('series')
	await expect(all.getByRole('button')).toHaveCount(4)
	await page.getByRole('main').evaluate((main) => {
		main.scrollTop = main.scrollHeight
	})
	const footerBox = await footer.boundingBox()
	const mainBox = await page.getByRole('main').boundingBox()
	const lastBookBox = await all
		.getByRole('button', { name: /未分類/ })
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

test('bookshelf opens a ZIP in the reader and closes through settings back to shelf', async ({
	page,
}) => {
	const archive = await makeZip()
	let bookRequests = 0
	await page.route('**/api/books**', async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname === '/api/books') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					books: [
						{
							...books[2],
							size: archive.length,
						},
					],
				}),
			})
		} else if (url.pathname.endsWith('/cover')) {
			await route.fulfill({ status: 404, body: 'Not found' })
		} else {
			bookRequests += 1
			await route.fulfill({
				status: 200,
				contentType: 'application/zip',
				body: archive,
			})
		}
	})
	await page.goto('/bookshelf')
	const all = page.getByRole('region', { name: 'すべての本' })
	await expect(all.getByRole('button', { name: /別作品/ })).toBeVisible()
	const shelfFooter = page.getByRole('contentinfo', {
		name: '本棚の絞り込みと表示設定',
	})
	await page.getByRole('button', { name: '検索', exact: true }).click()
	await page.getByLabel('タイトル・シリーズで検索').fill('月の森')
	await expect(all.getByRole('button', { name: /別作品/ })).toBeVisible()
	await expect.poll(() => bookRequests).toBe(0)
	await all.getByRole('button', { name: /別作品/ }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await expect(shelfFooter).toBeHidden()
	await expect(page.getByRole('region', { name: 'すべての本' })).toHaveCount(0)
	await expect.poll(() => bookRequests).toBe(1)
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(page).toHaveURL('/bookshelf')
	await expect(page.getByLabel('タイトル・シリーズで検索')).toHaveValue(
		'月の森',
	)
	await expect(
		page
			.getByRole('region', { name: 'すべての本' })
			.getByRole('button', { name: /別作品/ }),
	).toBeVisible()

	await page
		.getByRole('button', { name: /別作品/ })
		.last()
		.click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await page.getByRole('button', { name: '設定' }).click()
	await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
	await page.getByRole('button', { name: '読書に戻る' }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await expect.poll(() => bookRequests).toBe(2)
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(page).toHaveURL('/bookshelf')
	await expect(page.getByRole('heading', { name: '本棚' })).toBeVisible()
	await expect(shelfFooter).toBeVisible()
	await expect(
		page.getByRole('button', { name: '検索', exact: true }),
	).toBeVisible()
})

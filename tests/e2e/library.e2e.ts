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
	options: {
		listStatus?: number
		downloadHtml?: boolean
		listPayload?: unknown
	} = {},
) => {
	await page.route('**/api/books**', async (route) => {
		const url = new URL(route.request().url())
		if (url.pathname === '/api/books') {
			await route.fulfill({
				status: options.listStatus ?? 200,
				contentType: 'application/json',
				body: JSON.stringify(
					options.listPayload ?? {
						books: [
							{
								id: bookId,
								name: 'sample-fixture.zip',
								format: 'zip',
								size: archive.length,
							},
						],
					},
				),
			})
		} else if (options.downloadHtml) {
			await route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: '<h1>Login</h1>',
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

test('private ZIP opens in the reader and keeps settings', async ({ page }) => {
	const archive = await makeZip(['page.png'])
	await routeLibrary(page, archive)
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await page.getByRole('button', { name: /sample-fixture\.zip/ }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
	await page.getByRole('button', { name: '設定' }).click()
	await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
	await page.getByRole('button', { name: '読書に戻る' }).click()
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
})

test('authentication errors leave the local file picker usable', async ({
	page,
}) => {
	const archive = await makeZip(['page.png'])
	await routeLibrary(page, archive, { listStatus: 401 })
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await expect(
		page.getByText('クラウドの本を読むにはログインが必要です。'),
	).toBeVisible()
	await page.locator('input[type=file]').setInputFiles({
		name: 'local-fixture.zip',
		mimeType: 'application/zip',
		buffer: archive,
	})
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
})

test('malformed cloud list reports failure and leaves the local picker usable', async ({
	page,
}) => {
	const archive = await makeZip(['local.png'])
	await routeLibrary(page, archive, { listPayload: { books: 'invalid' } })
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await expect(
		page.getByText('クラウドの本を確認できませんでした。'),
	).toBeVisible()
	await expect(page.getByText('クラウドに本はありません。')).toHaveCount(0)
	await page.locator('input[type=file]').setInputFiles({
		name: 'local-fixture.zip',
		mimeType: 'application/zip',
		buffer: archive,
	})
	await expect(page.getByRole('img', { name: '画像 1 / 1' })).toBeVisible()
})

test('HTML download responses are reported and never opened as a book', async ({
	page,
}) => {
	const archive = await makeZip(['page.png'])
	await routeLibrary(page, archive, { downloadHtml: true })
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await page.getByRole('button', { name: /sample-fixture\.zip/ }).click()
	await expect(page.getByRole('alert')).toContainText(
		'本をダウンロードできませんでした',
	)
	await expect(page.getByRole('main', { name: '読書ページ' })).toHaveCount(0)
})

test('leaving the library cancels a pending cloud download', async ({
	page,
}) => {
	const archive = await makeZip(['cloud.png'])
	let releaseDownload!: () => void
	const downloadReleased = new Promise<void>((resolve) => {
		releaseDownload = resolve
	})
	let markDownloadStarted!: () => void
	const downloadStarted = new Promise<void>((resolve) => {
		markDownloadStarted = resolve
	})
	await page.route('**/api/books**', async (route) => {
		if (new URL(route.request().url()).pathname === '/api/books') {
			await route.fulfill({
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
			return
		}
		markDownloadStarted()
		await downloadReleased
		await route
			.fulfill({
				status: 200,
				contentType: 'application/zip',
				body: archive,
			})
			.catch(() => {})
	})
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await page.getByRole('button', { name: /sample-fixture\.zip/ }).click()
	await downloadStarted
	await page.getByRole('button', { name: '設定' }).click()
	await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
	await page.getByRole('button', { name: '戻る' }).click()
	await expect(
		page.getByRole('button', { name: 'ファイルを選ぶ' }),
	).toBeVisible()
	releaseDownload()
	await page.waitForTimeout(200)
	await expect(
		page.getByRole('button', { name: 'ファイルを選ぶ' }),
	).toBeVisible()
	await expect(page.getByRole('main', { name: '読書ページ' })).toHaveCount(0)
})

test('cancelled cloud download cannot replace a newly selected local file', async ({
	page,
}) => {
	const cloudArchive = await makeZip(['cloud.png'])
	const localArchive = await makeZip(['local-one.png', 'local-two.png'])
	let releaseDownload!: () => void
	const downloadReleased = new Promise<void>((resolve) => {
		releaseDownload = resolve
	})
	let markDownloadStarted!: () => void
	const downloadStarted = new Promise<void>((resolve) => {
		markDownloadStarted = resolve
	})
	let markDownloadFinished!: () => void
	const downloadFinished = new Promise<void>((resolve) => {
		markDownloadFinished = resolve
	})
	await page.route('**/api/books**', async (route) => {
		if (new URL(route.request().url()).pathname === '/api/books') {
			await route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify({
					books: [
						{
							id: bookId,
							name: 'sample-fixture.zip',
							format: 'zip',
							size: cloudArchive.length,
						},
					],
				}),
			})
			return
		}
		markDownloadStarted()
		await downloadReleased
		await route
			.fulfill({
				status: 200,
				contentType: 'application/zip',
				body: cloudArchive,
			})
			.catch(() => {})
		markDownloadFinished()
	})
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await page.getByRole('button', { name: /sample-fixture\.zip/ }).click()
	await downloadStarted
	const cloudRequestFailed = page.waitForEvent('requestfailed', (request) => {
		const url = new URL(request.url())
		return url.pathname.startsWith(`/api/books/${bookId}`)
	})
	await page.locator('input[type=file]').setInputFiles({
		name: 'local-fixture.zip',
		mimeType: 'application/zip',
		buffer: localArchive,
	})
	await expect(page.getByRole('img', { name: '画像 1 / 2' })).toBeVisible()
	releaseDownload()
	await downloadFinished
	await cloudRequestFailed
	await expect(page.getByRole('img', { name: '画像 1 / 2' })).toBeVisible()
})

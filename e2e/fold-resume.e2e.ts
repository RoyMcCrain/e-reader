import { createHash } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'
import {
	BlobWriter,
	TextReader,
	Uint8ArrayReader,
	ZipWriter,
} from '@zip.js/zip.js'

import {
	makePositionEpub,
	savedPointIsVisible,
	type PositionView,
} from './epub-position-fixture'
import { revealReader, turnPage } from './reader-actions'

const LAST_SESSION_KEY = 'shiori.reader.last-session.v1'
const bookId = 'f'.repeat(64)
const seeded = JSON.stringify({
	bookId,
	name: 'seeded.epub',
	format: 'epub',
	updatedAt: 1,
})
const resumeSection = (page: Page) =>
	page.getByRole('region', { name: '前回の続き' })
const resumeInput = (page: Page) =>
	resumeSection(page).locator('input[type=file]')
const progress = (page: Page) =>
	page.getByRole('progressbar', { name: '読書の進捗' })
const storedLastSession = (page: Page) =>
	page.evaluate((key) => localStorage.getItem(key), LAST_SESSION_KEY)
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
	'base64',
)

const seedLastSession = async (page: Page, value: string) => {
	await page.addInitScript(
		([key, stored]) => {
			if (!localStorage.getItem(key)) localStorage.setItem(key, stored)
		},
		[LAST_SESSION_KEY, value] as const,
	)
}

const forceSingleSpread = async (page: Page) => {
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
	for (const name of ['1.png', '2.png', '3.png'])
		await writer.add(name, new Uint8ArrayReader(png))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

const makeTwoPageEpub = async () => {
	const writer = new ZipWriter(new BlobWriter())
	const pages = ['first', 'last']
	const files = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">two-page</dc:identifier><dc:title>Two pages</dc:title><dc:language>en</dc:language><meta property="rendition:layout">pre-paginated</meta></metadata><manifest>${pages.map((name) => `<item id="${name}" href="${name}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${pages.map((name) => `<itemref idref="${name}"/>`).join('')}</spine></package>`,
		...Object.fromEntries(
			pages.map((name) => [
				`${name}.xhtml`,
				`<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=600,height=800"/></head><body><p>${name}</p></body></html>`,
			]),
		),
	}
	for (const [name, text] of Object.entries(files))
		await writer.add(name, new TextReader(text))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

const makeCorruptFinalArchive = async () => {
	const writer = new ZipWriter(new BlobWriter())
	await writer.add('1.png', new Uint8ArrayReader(png))
	await writer.add('2.png', new Uint8ArrayReader(Uint8Array.from([1, 2, 3])))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

test('the local resume appears while the cloud lookup is still pending', async ({
	page,
}) => {
	await seedLastSession(page, seeded)
	await page.route('**/api/books', () => {})
	await page.goto('/')
	await expect(
		resumeSection(page).getByRole('button', { name: 'ファイルを選んで再開' }),
	).toBeVisible()
})

test('an EPUB position survives a reload and reselection', async ({ page }) => {
	await page.route('**/api/reading-positions/**', (route) =>
		route.fulfill({ status: 503, json: { error: 'offline' } }),
	)
	const bytes = Buffer.from(await makePositionEpub('ltr'))
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'book.epub',
		mimeType: 'application/epub+zip',
		buffer: bytes,
	})
	const view = page.locator('[data-reader-page="primary"] foliate-view')
	await expect
		.poll(() =>
			view.evaluate((el) => Boolean((el as PositionView).lastLocation?.cfi)),
		)
		.toBe(true)
	await turnPage(page, true)
	await revealReader(page)
	await expect(
		page.locator('output').filter({ hasText: '同期は保留中です。' }),
	).toBeVisible()
	const saved = await view.evaluate(
		(el) => (el as PositionView).lastLocation?.cfi,
	)
	if (!saved) throw new Error('Reading location was not available')

	await page.reload()
	await expect(resumeSection(page)).toBeVisible()
	await resumeInput(page).setInputFiles({
		name: 'book.epub',
		mimeType: 'application/epub+zip',
		buffer: bytes,
	})
	await expect.poll(() => savedPointIsVisible(view, saved)).toBe(true)
})

test('a ZIP page survives a reload and reselection', async ({ page }) => {
	await forceSingleSpread(page)
	const bytes = await makeArchive()
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: bytes,
	})
	await expect(page.getByRole('img', { name: '画像 1 / 3' })).toBeVisible()
	await turnPage(page, true)
	await expect(page.getByRole('img', { name: '画像 2 / 3' })).toBeVisible()

	await page.reload()
	await resumeInput(page).setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: bytes,
	})
	await expect(page.getByRole('img', { name: '画像 2 / 3' })).toBeVisible()
})

test('a cloud book resumes with 続きを読む until its final page is read', async ({
	page,
}) => {
	await forceSingleSpread(page)
	const bytes = await makeArchive()
	const id = createHash('sha256').update(bytes).digest('hex')
	await page.route('**/api/books', (route) =>
		route.fulfill({
			json: {
				books: [{ id, name: 'comic.zip', format: 'zip', size: bytes.length }],
			},
		}),
	)
	await page.route(`**/api/books/${id}`, (route) =>
		route.fulfill({ contentType: 'application/zip', body: bytes }),
	)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: bytes,
	})
	await turnPage(page, true)
	await expect(page.getByRole('img', { name: '画像 2 / 3' })).toBeVisible()

	await page.reload()
	const resume = resumeSection(page).getByRole('button', { name: '続きを読む' })
	await expect(resume).toBeVisible()
	await resume.click()
	await expect(page.getByRole('img', { name: '画像 2 / 3' })).toBeVisible()
	await turnPage(page, true)
	await expect(page.getByRole('img', { name: '画像 3 / 3' })).toBeVisible()

	await page.reload()
	await page.waitForLoadState('networkidle')
	await expect(resumeSection(page)).toHaveCount(0)
})

test('a failed EPUB open keeps the previous last session', async ({ page }) => {
	await seedLastSession(page, seeded)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	const chooser = page.waitForEvent('filechooser')
	await page.getByRole('button', { name: 'ファイルを開く' }).click()
	await (
		await chooser
	).setFiles({
		name: 'broken.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from('not an epub'),
	})
	await expect(page.getByRole('alert').first()).toBeVisible()
	await expect
		.poll(() =>
			page.evaluate((key) => localStorage.getItem(key), LAST_SESSION_KEY),
		)
		.toBe(seeded)
})

test('a remote EPUB position adopted at the final page removes the resume section', async ({
	page,
	browser,
	baseURL,
}) => {
	await forceSingleSpread(page)
	const bytes = await makeTwoPageEpub()
	await page.route('**/api/reading-positions/**', (route) =>
		route.fulfill({ status: 503, json: { error: 'offline' } }),
	)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'two.epub',
		mimeType: 'application/epub+zip',
		buffer: bytes,
	})
	await turnPage(page, true)
	await expect(progress(page)).toHaveAttribute('aria-valuenow', '100')
	const cfi = await page
		.locator('[data-reader-page="primary"] foliate-view')
		.evaluate((el) => (el as PositionView).lastLocation?.cfi)
	if (!cfi) throw new Error('Final EPUB location was not available')

	const context = await browser.newContext({ baseURL })
	try {
		const fresh = await context.newPage()
		await forceSingleSpread(fresh)
		await fresh.route('**/api/reading-positions/**', (route) =>
			route.fulfill({
				json: {
					position: {
						cfi,
						revision: 2,
						mutationId: '123e4567-e89b-42d3-a456-426614174000',
					},
				},
			}),
		)
		await fresh.goto('/bookshelf')
		await fresh.waitForLoadState('networkidle')
		await fresh.locator('input[type=file]').setInputFiles({
			name: 'two.epub',
			mimeType: 'application/epub+zip',
			buffer: bytes,
		})
		await expect(progress(fresh)).toHaveAttribute('aria-valuenow', '100')
		await expect(
			fresh
				.locator('output')
				.filter({ hasText: '別端末の位置に移動しました。' }),
		).toBeVisible()
		await expect.poll(() => storedLastSession(fresh)).toBeNull()
		await revealReader(fresh)
		await fresh.getByRole('button', { name: '本を閉じる' }).click()
		await expect(fresh.getByRole('region', { name: '読書画面' })).toHaveCount(0)
		await fresh.reload()
		await fresh.waitForLoadState('networkidle')
		await expect(resumeSection(fresh)).toHaveCount(0)
	} finally {
		await context.close()
	}
})

test('a corrupt final ZIP image shows an error and keeps the resume entry', async ({
	page,
}) => {
	await forceSingleSpread(page)
	const bytes = await makeCorruptFinalArchive()
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'corrupt.zip',
		mimeType: 'application/zip',
		buffer: bytes,
	})
	await expect(page.getByRole('img', { name: '画像 1 / 2' })).toBeVisible()
	await turnPage(page, true)
	await expect(page.getByRole('alert')).toHaveText(
		'画像を読み込めませんでした。',
	)
	await revealReader(page)
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await expect(page.getByRole('region', { name: '読書画面' })).toHaveCount(0)

	await page.reload()
	await page.waitForLoadState('networkidle')
	await expect(resumeSection(page)).toBeVisible()
})

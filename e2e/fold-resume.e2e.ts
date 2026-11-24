import { expect, test, type Page } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

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
	const png = new Uint8ArrayReader(
		Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
			'base64',
		),
	)
	await writer.add('1.png', png)
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
	await expect(page.getByRole('img', { name: '画像 1 / 2' })).toBeVisible()
	await turnPage(page, true)
	await expect(page.getByRole('img', { name: '画像 2 / 2' })).toBeVisible()

	await page.reload()
	await resumeInput(page).setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: bytes,
	})
	await expect(page.getByRole('img', { name: '画像 2 / 2' })).toBeVisible()
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

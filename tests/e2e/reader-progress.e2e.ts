import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

import { turnPage } from './reader-actions'

test('ZIP progress follows visible pages, remaining pages, and completion', async ({
	page,
}) => {
	await page.addInitScript(() => {
		localStorage.setItem(
			'shiori.reader.settings.v1',
			JSON.stringify({ spread: 'double', firstPageSingle: true }),
		)
	})
	const pixel = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
		'base64',
	)
	const writer = new ZipWriter(new BlobWriter())
	for (let index = 1; index <= 6; index++)
		await writer.add(`${index}.png`, new Uint8ArrayReader(pixel))
	const buffer = Buffer.from(await (await writer.close()).arrayBuffer())
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'synthetic.zip',
		mimeType: 'application/zip',
		buffer,
	})

	const progress = page.getByRole('progressbar', { name: '読書の進捗' })
	await expect(progress).toHaveAttribute(
		'aria-valuetext',
		'1/6、17%、あと5ページ',
	)
	await expect(page.locator('footer')).toHaveText('1/6')
	await expect(page.getByTitle('1/6、17%、あと5ページ')).toBeVisible()
	await turnPage(page, true)
	await expect(progress).toHaveAttribute(
		'aria-valuetext',
		'2–3/6、50%、あと3ページ',
	)
	await expect(page.getByTitle('2–3/6、50%、あと3ページ')).toBeVisible()
	await expect(page.locator('footer')).toHaveText('2–3/6')
	await turnPage(page, true)
	await turnPage(page, true)
	await expect(progress).toHaveAttribute(
		'aria-valuetext',
		'6/6、100%、最終ページ',
	)
	await turnPage(page, false)
	await expect(progress).toHaveAttribute(
		'aria-valuetext',
		'4–5/6、83%、あと1ページ',
	)
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await page.locator('input[type=file]').setInputFiles({
		name: 'synthetic.zip',
		mimeType: 'application/zip',
		buffer,
	})
	const reopened = page.getByRole('progressbar', { name: '読書の進捗' })
	await expect(reopened).toHaveAttribute(
		'aria-valuetext',
		'1/6、17%、あと5ページ',
	)
})

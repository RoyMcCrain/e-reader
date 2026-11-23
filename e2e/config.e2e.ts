import { expect, test } from '@playwright/test'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'

import { revealReader, turnPage } from './reader-actions'

const persistedNumber = (
	page: import('@playwright/test').Page,
	key: 'fontSize' | 'lineHeight',
) =>
	page.evaluate((setting) => {
		const stored: unknown = JSON.parse(
			localStorage.getItem('shiori.reader.settings.v1') ?? '{}',
		)
		if (typeof stored !== 'object' || stored === null || !(setting in stored))
			return undefined
		const settings = stored as Record<string, unknown>
		const value = settings[setting]
		return typeof value === 'number' ? value : undefined
	}, key)

const makeArchive = async () => {
	const writer = new ZipWriter(new BlobWriter())
	const pixel = Uint8Array.from(
		Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
			'base64',
		),
	)
	for (const name of ['1.png', '2.png', '3.png'])
		await writer.add(name, new Uint8ArrayReader(pixel))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

test('config overlays a live book and disables its keyboard input', async ({
	page,
}) => {
	await page.goto('/config')
	await page.waitForLoadState('networkidle')
	await page.getByRole('combobox', { name: '見開き' }).selectOption('single')
	await page.getByRole('button', { name: '戻る' }).click()
	await page.waitForLoadState('networkidle')
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'comic.zip',
		mimeType: 'application/zip',
		buffer: await makeArchive(),
	})
	await expect(page.getByRole('img', { name: '画像 1 / 3' })).toBeVisible()
	await turnPage(page, true)
	await expect(page.getByRole('img', { name: '画像 2 / 3' })).toBeVisible()
	await revealReader(page)
	await page.getByRole('button', { name: '設定' }).click()
	await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
	const readerShell = page.locator('[aria-hidden="true"]').filter({
		has: page.locator('img[alt="画像 2 / 3"]'),
	})
	await expect(readerShell).toHaveCount(1)
	await expect(readerShell).toHaveCSS('visibility', 'hidden')
	await expect(page.locator('img[alt="画像 2 / 3"]')).toBeAttached()
	await expect(page.locator('img[alt="画像 2 / 3"]')).toBeHidden()
	await page.keyboard.press('ArrowRight')
	await expect(page.locator('img[alt="画像 2 / 3"]')).toBeHidden()
	const fontSize = page.getByLabel('文字サイズの値')
	await fontSize.click()
	await fontSize.press('Control+A')
	await page.keyboard.type('24')
	await fontSize.press('Tab')
	await expect.poll(() => persistedNumber(page, 'fontSize')).toBe(24)
	const lineHeight = page.getByLabel('行間の値')
	await lineHeight.click()
	await lineHeight.press('Control+A')
	await page.keyboard.type('2.1')
	await lineHeight.press('Enter')
	await expect(lineHeight).toHaveValue('2.1')
	await expect.poll(() => persistedNumber(page, 'lineHeight')).toBe(2.1)
	await page.getByRole('button', { name: '読書に戻る' }).click()
	await expect(page.getByRole('img', { name: '画像 2 / 3' })).toBeVisible()
	await page.getByRole('button', { name: '設定' }).click()
	await expect(page.getByLabel('文字サイズの値')).toHaveValue('24')
	await page.reload()
	await expect(page.getByLabel('行間の値')).toHaveValue('2.1')
	expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain(
		'file',
	)
})

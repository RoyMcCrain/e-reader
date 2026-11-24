import { expect, test } from '@playwright/test'

import {
	makePositionEpub,
	savedPointIsVisible,
	type PositionView,
} from './epub-position-fixture'
import { revealReader, turnPage } from './reader-actions'

test('a local EPUB position survives reselection with a different filename', async ({
	page,
}) => {
	await page.route('**/api/reading-positions/**', (route) =>
		route.fulfill({ status: 503, json: { error: 'offline' } }),
	)
	const bytes = Buffer.from(await makePositionEpub('ltr'))
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	const choose = async (name: string) =>
		page
			.getByRole('navigation', { name: 'メインナビゲーション' })
			.locator('input[type=file]')
			.setInputFiles({
				name,
				mimeType: 'application/epub+zip',
				buffer: bytes,
			})
	await choose('first.epub')
	const view = page.locator('[data-reader-page="primary"] foliate-view')
	await expect
		.poll(() =>
			view.evaluate((el) => Boolean((el as PositionView).lastLocation?.cfi)),
		)
		.toBe(true)
	await expect(
		page.getByText('本を開いています…', { exact: true }),
	).toBeHidden()
	const beforeTurn = await view.evaluate(
		(el) => (el as PositionView).lastLocation?.cfi,
	)
	if (!beforeTurn) throw new Error('Reading location was not available')
	await turnPage(page, true)
	await expect
		.poll(() => view.evaluate((el) => (el as PositionView).lastLocation?.cfi))
		.toBeDefined()
	await expect
		.poll(() => view.evaluate((el) => (el as PositionView).lastLocation?.cfi))
		.not.toBe(beforeTurn)
	await revealReader(page)
	await expect(
		page.locator('output').filter({ hasText: '同期は保留中です。' }),
	).toBeVisible()
	const saved = await view.evaluate(
		(el) => (el as PositionView).lastLocation?.cfi,
	)
	if (!saved) throw new Error('Reading location was not available')
	await page.getByRole('button', { name: '本を閉じる' }).click()
	await choose('renamed.epub')
	await expect.poll(() => savedPointIsVisible(view, saved)).toBe(true)
})

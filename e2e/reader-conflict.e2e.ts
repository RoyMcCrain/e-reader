import { expect, test } from '@playwright/test'

import { makePositionEpub } from './epub-position-fixture'
import { revealReader, turnPage } from './reader-actions'

const remoteConflict = {
	cfi: 'epubcfi(/6/2[chapter]!/4/2:0)',
	revision: 7,
	mutationId: '123e4567-e89b-12d3-a456-426614174000',
}

for (const direction of ['ltr', 'rtl'] as const) {
	test(`reader conflict actions stay right-aligned on phone widths (${direction})`, async ({
		page,
	}) => {
		await page.route('**/api/reading-positions/**', (route) => {
			if (route.request().method() === 'PUT')
				return route.fulfill({
					status: 409,
					contentType: 'application/json',
					body: JSON.stringify({ position: remoteConflict }),
				})
			return route.fallback()
		})
		await page.goto('/bookshelf')
		await page.locator('input[type=file]').setInputFiles({
			name: `${direction}-conflict.epub`,
			mimeType: 'application/epub+zip',
			buffer: Buffer.from(await makePositionEpub(direction)),
		})
		await expect(
			page.getByText('本を開いています…', { exact: true }),
		).toBeHidden()
		await turnPage(page, true)
		const useLocal = page.getByRole('button', {
			name: 'この端末の位置を使う',
		})
		const useRemote = page.getByRole('button', {
			name: '別端末の位置を使う',
		})
		await expect(useLocal).toBeVisible({ timeout: 10000 })
		await expect(useRemote).toBeVisible()

		for (const width of [390, 320]) {
			await page.setViewportSize({ width, height: 844 })
			await revealReader(page)
			const status = page.locator('footer output').first()
			await expect(status).toBeVisible()
			// 状態表示は物理右寄せ（書籍の向きによらず direction を ltr に固定）。
			await expect(status).toHaveCSS('direction', 'ltr')
			const statusBox = await status.boundingBox()
			expect(statusBox).not.toBeNull()
			const localBox = await useLocal.boundingBox()
			const remoteBox = await useRemote.boundingBox()
			expect(localBox).not.toBeNull()
			expect(remoteBox).not.toBeNull()
			const contentRight = Math.max(
				localBox!.x + localBox!.width,
				remoteBox!.x + remoteBox!.width,
			)
			// 内容の右端が領域の右端に接していること（許容 2px、両側）。
			expect(
				Math.abs(statusBox!.x + statusBox!.width - contentRight),
			).toBeLessThanOrEqual(2)
			for (const action of [useLocal, useRemote]) {
				const box = await action.boundingBox()
				expect(box).not.toBeNull()
				expect(box!.x).toBeGreaterThanOrEqual(0)
				expect(box!.x + box!.width).toBeLessThanOrEqual(width)
			}
			const overflow = await page.evaluate(() => ({
				client: document.documentElement.clientWidth,
				scroll: document.documentElement.scrollWidth,
			}))
			expect(overflow.scroll).toBeLessThanOrEqual(overflow.client)
		}
	})
}

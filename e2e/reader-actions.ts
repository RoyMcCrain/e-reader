import { expect, type Page } from '@playwright/test'

export const revealReader = async (page: Page) => {
	const stage = page.getByRole('main', { name: '読書ページ' })
	const box = await stage.boundingBox()
	await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

const readerChrome = (page: Page) =>
	page.getByRole('region', { name: '読書画面' })

export const expectChromeHiddenImmediately = async (page: Page) => {
	await expect
		.poll(
			() =>
				Promise.all([
					readerChrome(page)
						.locator('header')
						.evaluate((element) => getComputedStyle(element).opacity),
					readerChrome(page)
						.locator('footer')
						.evaluate((element) => getComputedStyle(element).opacity),
				]),
			{ timeout: 700, intervals: [20] },
		)
		.toEqual(['0', '0'])
}

export const turnPage = async (page: Page, next: boolean) => {
	await expect(
		page.getByRole('progressbar', { name: '読書の進捗' }),
	).toBeVisible()
	await revealReader(page)
	await readerChrome(page)
		.locator('header')
		.click({ position: { x: 4, y: 2 } })
	await page.keyboard.press(next ? 'PageDown' : 'PageUp')
}

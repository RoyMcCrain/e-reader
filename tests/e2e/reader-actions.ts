import { expect, type Page } from '@playwright/test'

export const turnPage = async (page: Page, next: boolean) => {
	await expect(
		page.getByRole('progressbar', { name: '読書の進捗' }),
	).toBeVisible()
	await page.locator('header span[title]').click()
	await page.keyboard.press(next ? 'PageDown' : 'PageUp')
}

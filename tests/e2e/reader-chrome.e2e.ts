import { expect, test } from '@playwright/test'
import {
	BlobWriter,
	TextReader,
	Uint8ArrayReader,
	ZipWriter,
} from '@zip.js/zip.js'

import { expectChromeHiddenImmediately } from './reader-actions'

const makeEpub = async () => {
	const writer = new ZipWriter(new BlobWriter())
	const chapters = ['Opening', 'Middle', 'Ending']
	const manifest = chapters
		.map(
			(_, index) =>
				`<item id="c${index}" href="c${index}.xhtml" media-type="application/xhtml+xml"/>`,
		)
		.join('')
	const spine = chapters
		.map((_, index) => `<itemref idref="c${index}"/>`)
		.join('')
	const links = chapters
		.map(
			(chapter, index) =>
				`<li><a href="c${index}.xhtml">${chapter} chapter</a></li>`,
		)
		.join('')
	const files: Record<string, string> = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">chrome-test</dc:identifier><dc:title>Chrome</dc:title><dc:language>en</dc:language></metadata><manifest>${manifest}<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine>${spine}</spine></package>`,
		'nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${links}</ol></nav></body></html>`,
		...Object.fromEntries(
			chapters.map((chapter, index) => [
				`c${index}.xhtml`,
				`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>${chapter} content</p></body></html>`,
			]),
		),
	}
	for (const [name, content] of Object.entries(files))
		await writer.add(name, new TextReader(content))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

const makeZip = async () => {
	const writer = new ZipWriter(new BlobWriter())
	const pixel = Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII=',
		'base64',
	)
	for (let index = 1; index <= 3; index++)
		await writer.add(`${index}.png`, new Uint8ArrayReader(pixel))
	return Buffer.from(await (await writer.close()).arrayBuffer())
}

const openEpub = async (page: import('@playwright/test').Page) => {
	await page.goto('/')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'synthetic.epub',
		mimeType: 'application/epub+zip',
		buffer: await makeEpub(),
	})
	await expect(page.getByRole('button', { name: '目次' })).toBeEnabled()
	await expect.poll(() => epubContent(page)).toContain('Opening content')
}

const epubContent = (page: import('@playwright/test').Page) =>
	page
		.locator('foliate-view')
		.first()
		.evaluate(
			(element) =>
				(
					element as HTMLElement & {
						renderer?: { getContents(): { doc: Document }[] }
					}
				).renderer?.getContents()[0]?.doc.body.innerText,
		)

const opacity = (page: import('@playwright/test').Page, selector: string) =>
	page
		.locator(selector)
		.evaluate((element) => getComputedStyle(element).opacity)

const waitForFooterHidden = async (page: import('@playwright/test').Page) => {
	await expect
		.poll(() => opacity(page, 'footer'), { timeout: 1600, intervals: [20] })
		.toBe('0')
}

const waitForHiddenChrome = async (page: import('@playwright/test').Page) => {
	await expect
		.poll(() => opacity(page, 'header'), { timeout: 2800, intervals: [20] })
		.toBe('0')
	await expect
		.poll(() => opacity(page, 'footer'), { timeout: 400, intervals: [20] })
		.toBe('0')
}

test('EPUB chrome fades without moving the stage and document pointer activity reveals it', async ({
	page,
}) => {
	await openEpub(page)
	const header = page.locator('header')
	const footer = page.locator('footer')
	const stage = page.getByRole('main', { name: '読書ページ' })
	const bounds = await stage.boundingBox()
	expect(bounds).toEqual({ x: 0, y: 0, ...page.viewportSize() })
	await waitForFooterHidden(page)
	await expect(header).toHaveCSS('opacity', '1')
	await expect(footer).toHaveCSS('opacity', '0')
	await expect(footer).toHaveCSS('pointer-events', 'none')
	expect(await stage.boundingBox()).toEqual(bounds)
	const content = await epubContent(page)
	const pane = (await page
		.locator('[data-reader-page="primary"]')
		.boundingBox())!
	await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
	await expect(header).toHaveCSS('opacity', '1')
	await expect(footer).toHaveCSS('opacity', '1')
	await page.waitForTimeout(1150)
	await expect(footer).toHaveCSS('opacity', '0')
	await expect(header).toHaveCSS('opacity', '1')
	await expect.poll(() => opacity(page, 'header'), { timeout: 1000 }).toBe('0')
	await expect.poll(() => epubContent(page)).toBe(content)
	expect(await stage.boundingBox()).toEqual(bounds)

	await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
	await expect(header).toHaveCSS('opacity', '1')
	await page.locator('header span[title]').click()
	const close = page.getByRole('button', { name: '本を閉じる' })
	await close.focus()
	await expect(close).toBeFocused()
	await page.waitForTimeout(2400)
	await expect(header).toHaveCSS('opacity', '1')
	await expect(footer).toHaveCSS('opacity', '1')
})

test('TOC focus pins chrome; settings return clears the pin and idle hiding resumes', async ({
	page,
}) => {
	await openEpub(page)
	const header = page.locator('header')
	const trigger = page.getByRole('button', { name: '目次', exact: true })
	await trigger.click()
	const dialog = page.getByRole('dialog', { name: '目次', exact: true })
	await expect(dialog).toBeVisible()
	await dialog.evaluate((element) => element.focus())
	await page.waitForTimeout(2400)
	await expect(header).toHaveCSS('opacity', '1')
	await expect(page.locator('footer')).toHaveCSS('opacity', '1')
	await expect(dialog).toBeVisible()
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()

	await page.getByRole('button', { name: '設定' }).click()
	await expect(page.getByRole('heading', { name: '設定' })).toBeVisible()
	await page.getByRole('button', { name: '読書に戻る' }).click()
	await expect(header).toHaveCSS('opacity', '1')
	await page.locator('header span[title]').click()
	await waitForHiddenChrome(page)
})

test('EPUB document keyboard activity reveals chrome after chapter replacement', async ({
	page,
}) => {
	await page.setViewportSize({ width: 600, height: 800 })
	await openEpub(page)
	const stage = page.getByRole('main', { name: '読書ページ' })
	const header = page.locator('header')
	await stage.click({ position: { x: 300, y: 400 } })
	await waitForHiddenChrome(page)
	await page.keyboard.press('Shift')
	await expect(header).toHaveCSS('opacity', '1')
	await expect(page.locator('footer')).toHaveCSS('opacity', '1')

	await page.keyboard.press('PageDown')
	await expectChromeHiddenImmediately(page)
	await expect.poll(() => epubContent(page)).toContain('Middle content')
	await stage.click({ position: { x: 300, y: 400 } })
	await expect(header).toHaveCSS('opacity', '1')
	await expect(page.locator('footer')).toHaveCSS('opacity', '1')
	await page.keyboard.press('PageUp')
	await expectChromeHiddenImmediately(page)
	await expect.poll(() => epubContent(page)).toContain('Opening content')
	await stage.click({ position: { x: 300, y: 400 } })
	await waitForHiddenChrome(page)
	await page.keyboard.press('Shift')
	await expect(header).toHaveCSS('opacity', '1')
})

test.describe('touch chrome', () => {
	test.use({
		hasTouch: true,
		isMobile: true,
		viewport: { width: 390, height: 844 },
	})

	test('EPUB and ZIP center taps reveal chrome without turning the page', async ({
		page,
	}) => {
		await openEpub(page)
		await waitForHiddenChrome(page)
		await page.touchscreen.tap(195, 422)
		await expect(page.locator('header')).toHaveCSS('opacity', '1')
		await expect.poll(() => epubContent(page)).toContain('Opening content')
		await expect(page.locator('footer')).toHaveCSS('opacity', '1')
		await page.touchscreen.tap(380, 422)
		await expectChromeHiddenImmediately(page)
		await expect.poll(() => epubContent(page)).toContain('Middle content')
		await page.touchscreen.tap(195, 422)
		await expect(page.locator('header')).toHaveCSS('opacity', '1')
		await expect(page.locator('footer')).toHaveCSS('opacity', '1')
		const cdp = await page.context().newCDPSession(page)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchStart',
			touchPoints: [{ x: 300, y: 422 }],
		})
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: 100, y: 422 }],
		})
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchEnd',
			touchPoints: [],
		})
		await expectChromeHiddenImmediately(page)
		await expect.poll(() => epubContent(page)).toContain('Ending content')
		await page.touchscreen.tap(195, 422)
		await expect(page.locator('header')).toHaveCSS('opacity', '1')
		await cdp.detach()

		await page.getByRole('button', { name: '本を閉じる' }).click()
		await page.addInitScript(() => {
			localStorage.setItem(
				'shiori.reader.settings.v1',
				JSON.stringify({ spread: 'single', firstPageSingle: false }),
			)
		})
		await page.goto('/')
		await page.waitForLoadState('networkidle')
		await page.locator('input[type=file]').setInputFiles({
			name: 'synthetic.zip',
			mimeType: 'application/zip',
			buffer: await makeZip(),
		})
		await expect(page.getByRole('img', { name: '画像 1 / 3' })).toBeVisible()
		await waitForHiddenChrome(page)
		await page.touchscreen.tap(195, 422)
		await expect(page.locator('header')).toHaveCSS('opacity', '1')
		await expect(page.locator('footer')).toHaveCSS('opacity', '1')
		await expect(page.getByRole('img', { name: '画像 1 / 3' })).toBeVisible()
		await page.touchscreen.tap(380, 422)
		await expectChromeHiddenImmediately(page)
		await expect(page.getByRole('img', { name: '画像 2 / 3' })).toBeVisible()
	})
})

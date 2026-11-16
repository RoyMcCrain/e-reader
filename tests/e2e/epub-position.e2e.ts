import { expect, test } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import { collapse } from 'foliate-js/epubcfi.js'

interface PositionView extends HTMLElement {
	lastLocation?: { cfi?: string }
	renderer?: {
		getContents(): Array<{ doc: Document; index: number }>
	} | null
	resolveCFI(cfi: string): {
		index: number
		anchor(doc: Document): Range
	}
}

const makeEpub = async (direction: 'ltr' | 'rtl') => {
	const writer = new ZipWriter(new BlobWriter())
	const paragraphs = Array.from(
		{ length: 180 },
		(_, index) =>
			`<p>Paragraph ${index} <span>${'Reading position with nested text and ruby '.repeat(12)}<ruby>漢字<rt>かんじ</rt></ruby></span></p>`,
	).join('')
	const files = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" dir="${direction}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">position-${direction}</dc:identifier><dc:title>Position</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="${direction}"><itemref idref="chapter"/></spine></package>`,
		'chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><style>.publisher { font-family: monospace; font-size: 11px; line-height: 1.1; }</style></head><body class="publisher" style="writing-mode:${direction === 'rtl' ? 'vertical-rl' : 'horizontal-tb'}">${paragraphs}</body></html>`,
	}
	for (const [name, content] of Object.entries(files))
		await writer.add(name, new TextReader(content))
	return new Uint8Array(await (await writer.close()).arrayBuffer())
}

for (const direction of ['ltr', 'rtl'] as const) {
	test(`EPUB ${direction} reflow retains a mid-chapter reading point`, async ({
		page,
	}) => {
		await page.goto('/')
		await page.waitForLoadState('networkidle')
		await page.locator('input[type=file]').setInputFiles({
			name: `${direction}.epub`,
			mimeType: 'application/epub+zip',
			buffer: Buffer.from(await makeEpub(direction)),
		})
		const view = page.locator('[data-reader-page="primary"] foliate-view')
		await expect(
			page.getByText('本を開いています…', { exact: true }),
		).toBeHidden()
		await expect
			.poll(() =>
				view.evaluate((el) => Boolean((el as PositionView).lastLocation?.cfi)),
			)
			.toBe(true)

		const flushLayout = () =>
			view.evaluate(async (el) => {
				const doc = (el as PositionView).renderer?.getContents()[0]?.doc
				if (!doc?.defaultView) return
				await new Promise<void>((resolve) =>
					doc.defaultView!.requestAnimationFrame(() =>
						doc.defaultView!.requestAnimationFrame(() => resolve()),
					),
				)
			})
		const waitForLayout = async (
			fontSize: number,
			lineHeight: number,
			marginLeft = 8,
		) => {
			await expect
				.poll(() =>
					view.evaluate(
						(el, expected) => {
							const doc = (el as PositionView).renderer?.getContents()[0]?.doc
							if (!doc) return false
							const style = doc.defaultView?.getComputedStyle(doc.body)
							const font = Number.parseFloat(style?.fontSize ?? '')
							const line = Number.parseFloat(style?.lineHeight ?? '')
							return (
								Math.abs(font - expected.fontSize) < 0.1 &&
								Math.abs(line - expected.lineHeight) < 0.5
							)
						},
						{ fontSize, lineHeight, marginLeft },
					),
				)
				.toBe(true)
			await expect
				.poll(() =>
					page
						.getByLabel('読書ページ')
						.evaluate((host) =>
							Number.parseFloat(getComputedStyle(host).paddingLeft),
						),
				)
				.toBe(marginLeft)
			await flushLayout()
		}
		const next = page.getByRole('button', { name: '次へ' })
		for (let index = 0; index < 6; index++) {
			const previous = await view.evaluate(
				(el) => (el as PositionView).lastLocation?.cfi,
			)
			await next.click()
			await expect
				.poll(() =>
					view.evaluate((el) => (el as PositionView).lastLocation?.cfi),
				)
				.not.toBe(previous)
		}

		const capturePoint = async () => {
			const cfi = await view.evaluate(
				(el) => (el as PositionView).lastLocation?.cfi,
			)
			if (!cfi) throw new Error('EPUB location is not ready')
			return collapse(cfi)
		}
		const savedPointIsVisible = (savedCfi: string) =>
			view.evaluate((el, cfi) => {
				const epub = el as PositionView
				const content = epub.renderer?.getContents()[0]
				if (!content) return false
				try {
					const saved = epub.resolveCFI(cfi)
					if (saved.index !== content.index) return false
					const point = saved.anchor(content.doc)
					const child = point.startContainer.childNodes[point.startOffset]
					// A paragraph boundary and its first text offset denote the same reading point.
					if (child?.nodeType === Node.TEXT_NODE) point.setStart(child, 0)
					point.collapse(true)
					const text = point.startContainer
					if (
						text.nodeType === Node.TEXT_NODE &&
						point.startOffset < text.textContent!.length
					) {
						point.setEnd(text, point.startOffset + 1)
					}
					const rect = point.getBoundingClientRect()
					const frame = content.doc.defaultView?.frameElement
					if (!frame || rect.width <= 0 || rect.height <= 0) return false
					const frameBounds = frame.getBoundingClientRect()
					const viewBounds = epub.getBoundingClientRect()
					const centerX = rect.left + frameBounds.left + rect.width / 2
					const centerY = rect.top + frameBounds.top + rect.height / 2
					return (
						centerX >= viewBounds.left &&
						centerX < viewBounds.right &&
						centerY >= viewBounds.top &&
						centerY < viewBounds.bottom
					)
				} catch {
					return false
				}
			}, savedCfi)
		let marginLeft = 8
		const apply = async (
			label: string,
			value: string,
			fontSize: number,
			lineHeight: number,
			nextMarginLeft = marginLeft,
		) => {
			const input = page.getByLabel(label)
			await input.fill(value)
			await input.press('Tab')
			await waitForLayout(fontSize, lineHeight, nextMarginLeft)
			marginLeft = nextMarginLeft
		}

		await waitForLayout(18, 32.4)
		await page.getByRole('button', { name: '設定' }).click()
		const beforeKeyboard = await view.evaluate(
			(el) => (el as PositionView).lastLocation?.cfi,
		)
		await page.keyboard.press(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
		expect(
			await view.evaluate((el) => (el as PositionView).lastLocation?.cfi),
		).toBe(beforeKeyboard)
		let saved = await capturePoint()
		await apply('文字サイズの値', '24', 24, 43.2)
		await expect.poll(() => savedPointIsVisible(saved)).toBe(true)
		await apply('行間の値', '2.1', 24, 50.4)
		await expect.poll(() => savedPointIsVisible(saved)).toBe(true)
		await apply('左の値', '24', 24, 50.4, 24)
		await expect.poll(() => savedPointIsVisible(saved)).toBe(true)
		await page.getByRole('button', { name: '読書に戻る' }).click()
		await expect.poll(() => savedPointIsVisible(saved)).toBe(true)

		const beforeSecondVisit = await view.evaluate(
			(el) => (el as PositionView).lastLocation?.cfi,
		)
		await next.click()
		await expect
			.poll(() => view.evaluate((el) => (el as PositionView).lastLocation?.cfi))
			.not.toBe(beforeSecondVisit)
		await page.getByRole('button', { name: '設定' }).click()
		saved = await capturePoint()
		await apply('文字サイズの値', '20', 20, 42)
		await expect.poll(() => savedPointIsVisible(saved)).toBe(true)
		await page.getByRole('button', { name: '読書に戻る' }).click()
		await expect.poll(() => savedPointIsVisible(saved)).toBe(true)
		const waitForViewportLayout = async (width: number, height: number) => {
			await expect
				.poll(async () =>
					view.evaluate(
						(el, size) => {
							const host = el.closest('[aria-label="読書ページ"]')
							const content = (el as PositionView).renderer?.getContents()[0]
								?.doc
							const frame = content?.defaultView?.frameElement
							return Boolean(
								host &&
								content?.defaultView &&
								frame &&
								window.innerWidth === size.width &&
								window.innerHeight === size.height &&
								host.getBoundingClientRect().width > 0 &&
								Math.abs(
									content.defaultView.innerWidth -
										frame.getBoundingClientRect().width,
								) < 1,
							)
						},
						{ width, height },
					),
				)
				.toBe(true)
			await flushLayout()
			await expect.poll(() => savedPointIsVisible(saved)).toBe(true)
		}
		await page.setViewportSize({ width: 390, height: 844 })
		await waitForViewportLayout(390, 844)
		await page.setViewportSize({ width: 1280, height: 900 })
		await waitForViewportLayout(1280, 900)

		const previousLocation = await view.evaluate(
			(el) => (el as PositionView).lastLocation?.cfi,
		)
		for (let index = 0; index < 6; index++) await next.click()
		await expect
			.poll(() => view.evaluate((el) => (el as PositionView).lastLocation?.cfi))
			.not.toBe(previousLocation)
		await expect.poll(() => savedPointIsVisible(saved)).toBe(false)
		expect(
			await view.evaluate((el, cfi) => {
				const epub = el as PositionView
				const content = epub.renderer?.getContents()[0]
				if (!content) return false
				try {
					const point = epub.resolveCFI(cfi).anchor(content.doc)
					return (
						content.doc.body.contains(point.startContainer) &&
						content.doc.body.textContent!.length > 0 &&
						((content.doc.defaultView?.frameElement?.getBoundingClientRect()
							.width ?? 0) > epub.getBoundingClientRect().width ||
							(content.doc.defaultView?.frameElement?.getBoundingClientRect()
								.height ?? 0) > epub.getBoundingClientRect().height)
					)
				} catch {
					return false
				}
			}, saved),
		).toBe(true)
	})
}

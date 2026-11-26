import { expect, test } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

import { revealReader, turnPage } from './reader-actions'

type PageSide = 'left' | 'right' | 'center'
type FixedBook = {
	pages?: number
	rtl?: boolean
	sides?: (PageSide | undefined)[]
	toc?: { label: string; href: string }[]
}
const pageColors = ['#e02020', '#2040e0', '#20a040', '#e0a020', '#8020c0']
const pageAccents = ['#f0a020', '#20d0e0', '#d020c0', '#20e070', '#f04080']
const sideProperty = (side: PageSide | undefined) => {
	if (!side) return ''
	if (side === 'center') return ' properties="rendition:page-spread-center"'
	return ` properties="page-spread-${side}"`
}
const makeFixedEpub = async (
	imageStyle = 'width:100%;height:100%;object-fit:contain',
	book: FixedBook = {},
) => {
	const writer = new ZipWriter(new BlobWriter())
	const pages = Array.from(
		{ length: book.pages ?? 3 },
		(_, index) => `P${index + 1}`,
	)
	const files: Record<string, string> = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="fixed">fixed</dc:identifier><dc:title>Fixed</dc:title><dc:language>ja</dc:language><meta property="rendition:layout">pre-paginated</meta></metadata><manifest>${pages.map((page, index) => `<item id="p${index}" href="${page}.xhtml" media-type="application/xhtml+xml"/><item id="i${index}" href="${page}.svg" media-type="image/svg+xml"/>`).join('')}${book.toc ? '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' : ''}</manifest><spine${book.rtl ? ' page-progression-direction="rtl"' : ''}>${pages.map((page, index) => `<itemref idref="p${index}"${sideProperty(book.sides?.[index])}/>`).join('')}</spine></package>`,
		...(book.toc
			? {
					'nav.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>${book.toc.map(({ label, href }) => `<li><a href="${href}">${label}</a></li>`).join('')}</ol></nav></body></html>`,
				}
			: {}),
		...Object.fromEntries(
			pages.map((page) => [
				`${page}.xhtml`,
				`<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=600,height=800"/></head><body style="margin:0"><img src="${page}.svg" alt="${page}" style="${imageStyle}"/></body></html>`,
			]),
		),
		...Object.fromEntries(
			pages.map((page, index) => [
				`${page}.svg`,
				`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="${pageColors[index]}"/><path d="M0 0h300v800H0z" fill="${pageAccents[index]}"/><circle cx="450" cy="200" r="100" fill="white"/></svg>`,
			]),
		),
	}
	for (const [name, content] of Object.entries(files))
		await writer.add(name, new TextReader(content))
	return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const openFixedEpub = async (
	page: import('@playwright/test').Page,
	imageStyle = 'width:100%;height:100%;object-fit:contain',
) => {
	await page.setViewportSize({ width: 800, height: 900 })
	await page.addInitScript(() =>
		localStorage.setItem(
			'shiori.reader.settings.v1',
			JSON.stringify({ spread: 'single', firstPageSingle: false }),
		),
	)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'fixed.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(await makeFixedEpub(imageStyle)),
	})
	const view = page.locator('[data-reader-page="primary"] foliate-view')
	await expect
		.poll(() =>
			view.evaluate((element) =>
				Boolean((element as HTMLElement & { renderer?: unknown }).renderer),
			),
		)
		.toBe(true)
	await expect(
		page.getByText('本を開いています…', { exact: true }),
	).toBeHidden()
	return view
}

test('fixed-layout EPUB keeps a visible outgoing image while navigation is delayed', async ({
	page,
}) => {
	await page.setViewportSize({ width: 800, height: 900 })
	await page.addInitScript(() =>
		localStorage.setItem(
			'shiori.reader.settings.v1',
			JSON.stringify({ spread: 'single', firstPageSingle: false }),
		),
	)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'fixed.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(await makeFixedEpub()),
	})
	const view = page.locator('[data-reader-page="primary"] foliate-view')
	await expect
		.poll(() =>
			view.evaluate((element) =>
				Boolean((element as HTMLElement & { renderer?: unknown }).renderer),
			),
		)
		.toBe(true)
	await expect(
		page.getByText('本を開いています…', { exact: true }),
	).toBeHidden()
	await view.evaluate((element) => {
		const renderer = (
			element as HTMLElement & {
				renderer: { goTo: (...args: unknown[]) => Promise<void> }
			}
		).renderer
		const goTo = renderer.goTo.bind(renderer)
		let releaseBefore!: () => void
		let releaseAfter!: () => void
		const before = new Promise<void>((resolve) => (releaseBefore = resolve))
		const after = new Promise<void>((resolve) => (releaseAfter = resolve))
		const state = window as Window & {
			releaseBefore?: () => void
			releaseAfter?: () => void
			turnStarted?: boolean
			relocateReached?: boolean
		}
		state.releaseBefore = releaseBefore
		state.releaseAfter = releaseAfter
		renderer.goTo = async (...args) => {
			const target = args[0] as { index?: number } | undefined
			if (target?.index !== 1) return goTo(...args)
			state.turnStarted = true
			await before
			await goTo(...args)
			state.relocateReached = true
			await after
		}
	})
	const cdp = await page.context().newCDPSession(page)
	const box = await page.locator('[data-reader-spread]').boundingBox()
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [
			{ x: box!.x + box!.width * 0.8, y: box!.y + box!.height / 2 },
		],
	})
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [
			{ x: box!.x + box!.width * 0.2, y: box!.y + box!.height / 2 },
		],
	})
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await page.waitForFunction(() =>
		Boolean((window as Window & { turnStarted?: boolean }).turnStarted),
	)
	const paintedPixel = async () => {
		const box = await page.locator('[data-reader-spread]').boundingBox()
		const screenshot = await page.screenshot({
			clip: { x: box!.x, y: box!.y, width: box!.width, height: box!.height },
		})
		return page.evaluate(
			async (data) => {
				const image = new Image()
				image.src = data
				await image.decode()
				const canvas = document.createElement('canvas')
				canvas.width = image.width
				canvas.height = image.height
				const context = canvas.getContext('2d')!
				context.drawImage(image, 0, 0)
				return [
					...context.getImageData(
						Math.floor(image.width * 0.35),
						Math.floor(image.height * 0.5),
						1,
						1,
					).data,
				]
			},
			`data:image/png;base64,${screenshot.toString('base64')}`,
		)
	}
	const visibleImagePixels = () =>
		view.evaluate((element) => {
			const renderer = element as HTMLElement & {
				renderer?: { getContents(): { doc: Document }[] }
			}
			const image = renderer.renderer
				?.getContents()[0]
				?.doc.querySelector('img')
			if (!image) return 0
			const frame = image.ownerDocument.defaultView?.frameElement
			if (!frame) return 0
			const rect = image.getBoundingClientRect()
			const frameRect = frame.getBoundingClientRect()
			const viewport = element.ownerDocument.defaultView!.innerWidth
			const left = frameRect.left + rect.left
			return Math.max(
				0,
				Math.min(viewport, left + rect.width) - Math.max(0, left),
			)
		})
	await expect.poll(visibleImagePixels).toBeGreaterThan(100)
	const beforeNavigation = await paintedPixel()
	expect(beforeNavigation[0]).toBeGreaterThan(150)
	expect(beforeNavigation[2]).toBeLessThan(80)
	await page.evaluate(() =>
		(window as Window & { releaseBefore?: () => void }).releaseBefore?.(),
	)
	await page.waitForFunction(() =>
		Boolean((window as Window & { relocateReached?: boolean }).relocateReached),
	)
	expect(await paintedPixel()).toEqual(beforeNavigation)
	await page.evaluate(() =>
		(window as Window & { releaseAfter?: () => void }).releaseAfter?.(),
	)
	await expect
		.poll(() =>
			view.evaluate(
				(element) =>
					(
						element as HTMLElement & {
							renderer?: { getContents(): { doc: Document }[] }
						}
					).renderer
						?.getContents()[0]
						?.doc.querySelector('img')?.alt ?? '',
			),
		)
		.toContain('P2')
	await expect(page.locator('[data-reader-spread]')).toHaveCSS(
		'transform',
		'none',
	)
	await expect(page.locator('[data-reader-spread] canvas')).toHaveCount(0)
	const incomingPixels = await paintedPixel()
	expect(incomingPixels[2]).toBeGreaterThan(150)
	expect(incomingPixels[0]).toBeLessThan(80)
	await cdp.detach()
})

test('ignored iframe controls cancel stale gestures and remain interactive during turns', async ({
	page,
}) => {
	const view = await openFixedEpub(page)
	const docHandle = await view.evaluateHandle(
		(element) =>
			(
				element as HTMLElement & {
					renderer: { getContents(): { doc: Document }[] }
				}
			).renderer.getContents()[0].doc,
	)
	await docHandle.evaluate((doc) => {
		const control = doc.createElement('button')
		control.textContent = 'Control'
		doc.body.append(control)
		let received = false
		control.addEventListener('touchstart', (event) => {
			received = !event.defaultPrevented
		})
		;(
			doc.defaultView as Window & { controlReceived?: () => boolean }
		).controlReceived = () => received
	})
	const dispatched = await view.evaluate((element) => {
		const doc = (
			element as HTMLElement & {
				renderer: { getContents(): { doc: Document }[] }
			}
		).renderer.getContents()[0].doc
		const button = doc.querySelector('button')!
		const image = doc.querySelector('img')!
		const makeTouch = (target: Element, identifier: number, screenX: number) =>
			new Touch({
				identifier,
				target,
				screenX,
				screenY: 300,
				clientX: screenX,
				clientY: 300,
			})
		const send = (
			target: Element,
			type: string,
			touches: Touch[],
			changedTouches: Touch[],
		) => {
			const event = new TouchEvent(type, {
				bubbles: true,
				cancelable: true,
				touches,
				changedTouches,
			})
			target.dispatchEvent(event)
			return event
		}
		const first = makeTouch(image, 1, 500)
		send(image, 'touchstart', [first], [first])
		const moved = makeTouch(image, 1, 430)
		send(image, 'touchmove', [moved], [moved])
		const surface = doc.defaultView!.parent.document.querySelector(
			'[data-reader-spread]',
		)!
		const dragged = getComputedStyle(surface).transform
		const second = makeTouch(button, 2, 400)
		const controlEvent = send(button, 'touchstart', [moved, second], [second])
		const staleEnd = send(button, 'touchend', [], [moved])
		const settled = getComputedStyle(surface).transform
		return {
			controlDelivered: !controlEvent.defaultPrevented,
			staleEndIgnored: !staleEnd.defaultPrevented,
			dragged,
			settled,
		}
	})
	expect(dispatched.controlDelivered).toBe(true)
	expect(dispatched.staleEndIgnored).toBe(true)
	expect(dispatched.dragged).not.toBe('none')
	expect(dispatched.settled).toBe('none')
	await expect
		.poll(() =>
			view.evaluate(
				(element) =>
					(
						element as HTMLElement & {
							renderer: { getContents(): { doc: Document }[] }
						}
					).renderer
						.getContents()[0]
						.doc.querySelector('img')?.alt,
			),
		)
		.toBe('P1')
	const controlReceived = await view.evaluate((element) => {
		const win = (
			element as HTMLElement & {
				renderer: { getContents(): { doc: Document }[] }
			}
		).renderer.getContents()[0].doc.defaultView as Window & {
			controlReceived?: () => boolean
		}
		return win.controlReceived?.() ?? false
	})
	expect(controlReceived).toBe(true)
	await view.evaluate((element) => {
		const renderer = (
			element as HTMLElement & {
				renderer: { goTo: (...args: unknown[]) => Promise<void> }
			}
		).renderer
		const goTo = renderer.goTo.bind(renderer)
		let release!: () => void
		const gate = new Promise<void>((resolve) => (release = resolve))
		;(
			window as Window & { releaseTurn?: () => void; turnStarted?: boolean }
		).releaseTurn = release
		renderer.goTo = async (...args) => {
			if ((args[0] as { index?: number } | undefined)?.index !== 1)
				return goTo(...args)
			;(window as Window & { turnStarted?: boolean }).turnStarted = true
			await gate
			await goTo(...args)
		}
	})
	const box = await page.locator('[data-reader-spread]').boundingBox()
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [
			{ x: box!.x + box!.width * 0.8, y: box!.y + box!.height / 2 },
		],
	})
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [
			{ x: box!.x + box!.width * 0.2, y: box!.y + box!.height / 2 },
		],
	})
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await page.waitForFunction(() =>
		Boolean((window as Window & { turnStarted?: boolean }).turnStarted),
	)
	const surface = page.locator('[data-reader-spread]')
	const heldTransform = await surface.evaluate(
		(element) => getComputedStyle(element).transform,
	)
	const heldSnapshots = await surface.locator('canvas').count()
	const controlStatus = await view.evaluate((element) => {
		const doc = (
			element as HTMLElement & {
				renderer: { getContents(): { doc: Document }[] }
			}
		).renderer.getContents()[0].doc
		const button = doc.querySelector('button')!
		let delivered = false
		button.addEventListener(
			'touchstart',
			(event) => {
				delivered = !event.defaultPrevented
			},
			{ once: true },
		)
		const touch = new Touch({
			identifier: 3,
			target: button,
			screenX: 300,
			screenY: 300,
			clientX: 300,
			clientY: 300,
		})
		button.dispatchEvent(
			new TouchEvent('touchstart', {
				bubbles: true,
				cancelable: true,
				touches: [touch],
				changedTouches: [touch],
			}),
		)
		return delivered
	})
	expect(controlStatus).toBe(true)
	await expect(surface).toHaveCSS('transform', heldTransform)
	await expect(surface.locator('canvas')).toHaveCount(heldSnapshots)
	await page.evaluate(() =>
		(window as Window & { releaseTurn?: () => void }).releaseTurn?.(),
	)
	await expect
		.poll(() =>
			view.evaluate(
				(element) =>
					(
						element as HTMLElement & {
							renderer: { getContents(): { doc: Document }[] }
						}
					).renderer
						.getContents()[0]
						.doc.querySelector('img')?.alt,
			),
		)
		.toBe('P2')
	await cdp.detach()
})

test('filtered publisher image stays filtered during the outgoing swipe', async ({
	page,
}) => {
	const view = await openFixedEpub(
		page,
		'width:100%;height:100%;object-fit:contain;filter:invert(1)',
	)
	await view.evaluate((element) => {
		const renderer = (
			element as HTMLElement & {
				renderer: { goTo: (...args: unknown[]) => Promise<void> }
			}
		).renderer
		const goTo = renderer.goTo.bind(renderer)
		let release!: () => void
		const gate = new Promise<void>((resolve) => (release = resolve))
		;(
			window as Window & { releaseTurn?: () => void; turnStarted?: boolean }
		).releaseTurn = release
		renderer.goTo = async (...args) => {
			if ((args[0] as { index?: number } | undefined)?.index !== 1)
				return goTo(...args)
			;(window as Window & { turnStarted?: boolean }).turnStarted = true
			await gate
			await goTo(...args)
		}
	})
	const box = await page.locator('[data-reader-spread]').boundingBox()
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchStart',
		touchPoints: [
			{ x: box!.x + box!.width * 0.65, y: box!.y + box!.height / 2 },
		],
	})
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchMove',
		touchPoints: [
			{ x: box!.x + box!.width * 0.57, y: box!.y + box!.height / 2 },
		],
	})
	await cdp.send('Input.dispatchTouchEvent', {
		type: 'touchEnd',
		touchPoints: [],
	})
	await page.waitForFunction(() =>
		Boolean((window as Window & { turnStarted?: boolean }).turnStarted),
	)
	const bounds = await page.locator('[data-reader-spread]').boundingBox()
	const screenshot = await page.screenshot({
		clip: {
			x: bounds!.x,
			y: bounds!.y,
			width: bounds!.width,
			height: bounds!.height,
		},
	})
	const pixel = await page.evaluate(
		async (data) => {
			const image = new Image()
			image.src = data
			await image.decode()
			const canvas = document.createElement('canvas')
			canvas.width = image.width
			canvas.height = image.height
			const context = canvas.getContext('2d')!
			context.drawImage(image, 0, 0)
			return [
				...context.getImageData(
					Math.floor(image.width * 0.35),
					Math.floor(image.height * 0.5),
					1,
					1,
				).data,
			]
		},
		`data:image/png;base64,${screenshot.toString('base64')}`,
	)
	expect(pixel[0]).toBeLessThan(80)
	expect(pixel[2]).toBeGreaterThan(150)
	await page.evaluate(() =>
		(window as Window & { releaseTurn?: () => void }).releaseTurn?.(),
	)
	await expect
		.poll(() =>
			view.evaluate(
				(element) =>
					(
						element as HTMLElement & {
							renderer: { getContents(): { doc: Document }[] }
						}
					).renderer
						.getContents()[0]
						.doc.querySelector('img')?.alt,
			),
		)
		.toBe('P2')
	await cdp.detach()
})

test('fixed-layout EPUB navigates real pages and clamps the final spread', async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'shiori.reader.settings.v1',
			JSON.stringify({ spread: 'double', firstPageSingle: false }),
		),
	)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'fixed.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(await makeFixedEpub()),
	})
	const text = (name: string) =>
		page
			.locator(`[data-reader-page="${name}"] foliate-view`)
			.evaluate((element) => {
				const view = element as HTMLElement & {
					renderer?: { getContents(): { doc: Document }[] }
				}
				return (
					view.renderer?.getContents()[0]?.doc.querySelector('img')?.alt ?? ''
				)
			})
	await expect
		.poll(async () => `${await text('primary')}|${await text('secondary')}`)
		.toContain('P1|P2')
	await turnPage(page, true)
	await expect.poll(() => text('primary')).toContain('P3')
	await turnPage(page, true)
	await turnPage(page, false)
	await expect
		.poll(async () => `${await text('primary')}|${await text('secondary')}`)
		.toContain('P1|P2')
})

const openSpreadEpub = async (
	page: import('@playwright/test').Page,
	book: FixedBook,
	settings: { spread: 'auto'; firstPageSingle: boolean },
) => {
	await page.setViewportSize({ width: 900, height: 900 })
	await page.addInitScript(
		(value) =>
			localStorage.setItem('shiori.reader.settings.v1', JSON.stringify(value)),
		settings,
	)
	await page.goto('/bookshelf')
	await page.waitForLoadState('networkidle')
	const file = {
		name: 'fixed.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(await makeFixedEpub(undefined, book)),
	}
	await page.locator('input[type=file]').setInputFiles(file)
	await expect
		.poll(() =>
			page
				.locator('[data-reader-page="primary"] foliate-view')
				.evaluate((element) =>
					Boolean((element as HTMLElement & { renderer?: unknown }).renderer),
				),
		)
		.toBe(true)
	await expect(
		page.getByText('本を開いています…', { exact: true }),
	).toBeHidden()
	return file
}

// Visible synthetic pages ordered by physical x, so RTL slots read left to right.
const shownPages = (page: import('@playwright/test').Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('[data-reader-page]')]
			.flatMap((pane) => {
				const view = pane.querySelector('foliate-view') as
					| (HTMLElement & {
							renderer?: { getContents(): { doc: Document }[] }
					  })
					| null
				const image = view?.renderer?.getContents()[0]?.doc.querySelector('img')
				const frame = image?.ownerDocument.defaultView?.frameElement
				if (!image || !frame) return []
				if (getComputedStyle(frame).visibility === 'hidden') return []
				return [
					{
						alt: image.alt,
						x:
							frame.getBoundingClientRect().left +
							image.getBoundingClientRect().left,
					},
				]
			})
			.sort((a, b) => a.x - b.x)
			.map(({ alt, x }) => ({ alt, x: Math.round(x) })),
	)
const shownAlts = async (page: import('@playwright/test').Page) =>
	(await shownPages(page)).map(({ alt }) => alt)

test('fixed-layout EPUB keeps P2/P3 paired across width changes and reopening', async ({
	page,
}) => {
	const file = await openSpreadEpub(
		page,
		{ pages: 5 },
		{ spread: 'auto', firstPageSingle: true },
	)
	await expect.poll(() => shownAlts(page)).toEqual(['P1'])
	await turnPage(page, true)
	await expect.poll(() => shownAlts(page)).toEqual(['P2', 'P3'])
	await page.setViewportSize({ width: 500, height: 900 })
	await expect.poll(() => shownAlts(page)).toEqual(['P2'])
	await turnPage(page, true)
	await expect.poll(() => shownAlts(page)).toEqual(['P3'])
	await page.setViewportSize({ width: 900, height: 900 })
	await expect.poll(() => shownAlts(page)).toEqual(['P2', 'P3'])
	await page.setViewportSize({ width: 500, height: 900 })
	await expect.poll(() => shownAlts(page)).toEqual(['P3'])

	await page.setViewportSize({ width: 900, height: 900 })
	await page.reload()
	await page
		.getByRole('region', { name: '前回の続き' })
		.locator('input[type=file]')
		.setInputFiles(file)
	await expect.poll(() => shownAlts(page)).toEqual(['P2', 'P3'])
})

test('fixed-layout EPUB TOC to a broken link keeps the visible P3 position', async ({
	page,
}) => {
	await openSpreadEpub(
		page,
		{
			pages: 3,
			toc: [
				{ label: 'P3 entry', href: 'P3.xhtml' },
				{ label: 'Broken entry', href: 'missing.xhtml' },
			],
		},
		{ spread: 'auto', firstPageSingle: true },
	)
	const openToc = async () => {
		await revealReader(page)
		await page.getByRole('button', { name: '目次', exact: true }).click()
		return page.getByRole('navigation', { name: '目次' })
	}
	await expect.poll(() => shownAlts(page)).toEqual(['P1'])
	await (await openToc()).getByRole('button', { name: 'P3 entry' }).click()
	await expect.poll(() => shownAlts(page)).toEqual(['P2', 'P3'])
	await (await openToc()).getByRole('button', { name: 'Broken entry' }).click()
	await page.setViewportSize({ width: 500, height: 900 })
	await expect.poll(() => shownAlts(page)).toEqual(['P3'])
})

test('RTL fixed-layout EPUB places explicit left and right pages in their physical slots', async ({
	page,
}) => {
	await openSpreadEpub(
		page,
		{
			pages: 3,
			rtl: true,
			sides: ['left', 'right', 'left'],
		},
		{ spread: 'auto', firstPageSingle: false },
	)
	await expect
		.poll(() => shownPages(page))
		.toEqual([{ alt: 'P1', x: expect.any(Number) }])
	expect((await shownPages(page))[0].x).toBeLessThan(450)
	await turnPage(page, true)
	await expect.poll(() => shownAlts(page)).toEqual(['P3', 'P2'])
	const [left, right] = await shownPages(page)
	expect(left.x).toBeLessThan(450)
	expect(right.x).toBeGreaterThan(450)
})

import { expect, test } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

const makeEpub = async () => {
	const writer = new ZipWriter(new BlobWriter())
	const files = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf':
			'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">security-test</dc:identifier><dc:title>安全確認</dc:title><dc:language>ja</dc:language></metadata><manifest><item id="page" href="page.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="page"/></spine></package>',
		'page.xhtml':
			'<html xmlns="http://www.w3.org/1999/xhtml"><head><title>安全確認</title><style>@import url(https://attacker.invalid/import.css); .picture { background-image: url(https://attacker.invalid/background) } .publisher { color: rgb(1, 2, 3) }</style><meta http-equiv="refresh" content="0;url=https://attacker.invalid/refresh"/></head><body><script>parent.alert("script")</script><p class="publisher picture" onclick="parent.alert(1)"><ruby>本文<rt>ほんぶん</rt></ruby></p><img src="https://attacker.invalid/image" srcset="https://attacker.invalid/large 2x" onerror="parent.alert(2)"/><a href="java&#x09;script:parent.alert(3)">危険リンク</a><a ping="https://attacker.invalid/ping" href="data:text/html,attack">危険データリンク</a><img class="embedded" src="data:image/png;base64,iVBORw0KGgo="/><img class="srcset-data" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" srcset="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs= 1x"/><svg xmlns="http://www.w3.org/2000/svg" xmlns:p="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" xml:base="https://attacker.invalid/base/"><style>@\\69mport "https://attacker.invalid/svg.css"; .shape { fill: url(https://attacker.invalid/svg-image) } .set { background-image: image-set("https://attacker.invalid/set.png" 1x) }</style><script>alert(4)</script><foreignObject><img src="https://attacker.invalid/foreign"/></foreignObject><path d="M0 0h10v10z" fill="url(#gradient)"/><defs><linearGradient id="gradient"><stop offset="0" stop-color="red"/></linearGradient></defs><image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/><image p:href="https://attacker.invalid/xlink-image"/><a p:href="javascript:alert(5)"><text>link</text></a><text x="1" y="8">絵</text></svg></body></html>',
	}
	for (const [name, content] of Object.entries(files))
		await writer.add(name, new TextReader(content))
	return new Uint8Array(await (await writer.close()).arrayBuffer())
}

test('EPUB keeps publisher layout and illustration while blocking active content and fetches', async ({
	page,
}) => {
	const requests: string[] = []
	const pageErrors: string[] = []
	let dialogs = 0
	let localOrigin = ''
	page.on('pageerror', (error) => pageErrors.push(error.message))
	page.on('request', (request) => {
		const url = request.url()
		if (localOrigin && !url.startsWith('blob:') && !url.startsWith('data:')) {
			try {
				if (new URL(url).origin !== localOrigin) requests.push(url)
			} catch {
				requests.push(url)
			}
		}
	})
	await page.route('**/*', async (route) => {
		const url = route.request().url()
		let isLocal = false
		try {
			isLocal = new URL(url).origin === localOrigin
		} catch {}
		if (
			!localOrigin ||
			isLocal ||
			url.startsWith('blob:') ||
			url.startsWith('data:')
		)
			await route.continue()
		else await route.abort()
	})
	page.on('dialog', (dialog) => {
		dialogs += 1
		void dialog.dismiss()
	})
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
	await page.goto('/')
	localOrigin = new URL(page.url()).origin
	await page.waitForLoadState('networkidle')
	await page.locator('input[type=file]').setInputFiles({
		name: 'security.epub',
		mimeType: 'application/epub+zip',
		buffer: Buffer.from(await makeEpub()),
	})
	await expect(page.getByRole('region', { name: '読書画面' })).toBeVisible()
	await expect(page.getByRole('button', { name: '次へ' })).toBeEnabled()
	const foliate = page.locator('foliate-view')
	await expect(foliate).toHaveCount(1)
	await expect
		.poll(() =>
			foliate.evaluate((element) => {
				const documents = (
					element as HTMLElement & {
						renderer: { getContents(): Array<{ doc: Document }> }
					}
				).renderer.getContents()
				const doc = documents[0]?.doc
				if (!doc) return null
				return {
					ruby: doc.querySelector('ruby rt')?.textContent,
					path: doc.querySelector('svg path')?.getAttribute('d'),
					fill: doc.querySelector('svg path')?.getAttribute('fill'),
					svgImage: doc.querySelector('svg image')?.getAttribute('href'),
					embeddedImage: doc.querySelector('img.embedded')?.getAttribute('src'),
					srcset: doc.querySelector('img.srcset-data')?.getAttribute('srcset'),
					srcsetRendered:
						((doc.querySelector('img.srcset-data') as HTMLImageElement | null)
							?.naturalWidth ?? 0) > 0,
					xlink: [...doc.querySelectorAll('image, a')].some((element) =>
						[...element.attributes].some(
							(attribute) =>
								attribute.namespaceURI === 'http://www.w3.org/1999/xlink',
						),
					),
					xmlBase: [...doc.querySelectorAll('*')].some((element) =>
						[...element.attributes].some(
							(attribute) =>
								attribute.namespaceURI ===
									'http://www.w3.org/XML/1998/namespace' &&
								attribute.localName === 'base',
						),
					),
					svgCssSafe: !/attacker|https?:/i.test(
						doc.querySelector('svg style')?.textContent ?? '',
					),
					text: [...doc.querySelectorAll('svg text')].find(
						(element) => element.textContent === '絵',
					)?.textContent,
					active: doc.querySelectorAll(
						'script, foreignObject, animate, animateMotion, animateTransform, set, discard, [onclick], [onerror], meta[http-equiv="refresh"], [ping]',
					).length,
					dangerous: [...doc.querySelectorAll('[href], [src], [srcset]')].some(
						(element) =>
							['href', 'src', 'srcset'].some((name) =>
								/attacker\.invalid|javascript:|data:text\/html/i.test(
									(element.getAttribute(name) ?? '').replace(/[\t\r\n]/g, ''),
								),
							),
					),
					publisherStyle: doc.defaultView?.getComputedStyle(
						doc.querySelector('.publisher')!,
					).color,
					csp: doc
						.querySelector('head meta[http-equiv="Content-Security-Policy"]')
						?.getAttribute('content'),
				}
			}),
		)
		.toEqual({
			ruby: 'ほんぶん',
			path: 'M0 0h10v10z',
			fill: 'url(#gradient)',
			svgImage: 'data:image/png;base64,iVBORw0KGgo=',
			embeddedImage: 'data:image/png;base64,iVBORw0KGgo=',
			srcset: null,
			srcsetRendered: true,
			xlink: false,
			xmlBase: false,
			svgCssSafe: true,
			text: '絵',
			active: 0,
			dangerous: false,
			publisherStyle: 'rgb(1, 2, 3)',
			csp: expect.stringContaining("default-src 'none'"),
		})
	expect(requests).toEqual([])
	expect(dialogs).toBe(0)
	expect(pageErrors).toEqual([])
})

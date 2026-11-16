import { expect, test } from '@playwright/test'
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

import { turnPage } from './reader-actions'

const makeFixedEpub = async () => {
	const writer = new ZipWriter(new BlobWriter())
	const pages = ['P1', 'P2', 'P3']
	const files: Record<string, string> = {
		mimetype: 'application/epub+zip',
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="fixed">fixed</dc:identifier><dc:title>Fixed</dc:title><dc:language>ja</dc:language><meta property="rendition:layout">pre-paginated</meta></metadata><manifest>${pages.map((page, index) => `<item id="p${index}" href="${page}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine>${pages.map((page, index) => `<itemref idref="p${index}"/>`).join('')}</spine></package>`,
		...Object.fromEntries(
			pages.map((page) => [
				`${page}.xhtml`,
				`<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=600,height=800"/></head><body>${page}</body></html>`,
			]),
		),
	}
	for (const [name, content] of Object.entries(files))
		await writer.add(name, new TextReader(content))
	return new Uint8Array(await (await writer.close()).arrayBuffer())
}

test('fixed-layout EPUB navigates real pages and clamps the final spread', async ({
	page,
}) => {
	await page.addInitScript(() =>
		localStorage.setItem(
			'shiori.reader.settings.v1',
			JSON.stringify({ spread: 'double', firstPageSingle: false }),
		),
	)
	await page.goto('/')
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
				return view.renderer?.getContents()[0]?.doc.body.innerText ?? ''
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

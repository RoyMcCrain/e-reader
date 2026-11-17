import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'

export interface PositionView extends HTMLElement {
	lastLocation?: { cfi?: string }
	renderer?: {
		getContents(): Array<{ doc: Document; index: number }>
	} | null
	resolveCFI(cfi: string): {
		index: number
		anchor(doc: Document): Range
	}
}

export const makePositionEpub = async (direction: 'ltr' | 'rtl') => {
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

export const savedPointIsVisible = async (
	view: import('@playwright/test').Locator,
	cfi: string,
) =>
	view.evaluate((el, savedCfi) => {
		const epub = el as PositionView
		const content = epub.renderer?.getContents()[0]
		if (!content) return false
		try {
			const point = epub.resolveCFI(savedCfi).anchor(content.doc)
			if (epub.resolveCFI(savedCfi).index !== content.index) return false
			const child = point.startContainer.childNodes[point.startOffset]
			if (child?.nodeType === Node.TEXT_NODE) point.setStart(child, 0)
			point.collapse(true)
			const text = point.startContainer
			if (
				text.nodeType === Node.TEXT_NODE &&
				point.startOffset < text.textContent!.length
			)
				point.setEnd(text, point.startOffset + 1)
			const rect = point.getBoundingClientRect()
			const frame = content.doc.defaultView?.frameElement
			if (!frame || rect.width <= 0 || rect.height <= 0) return false
			const frameRect = frame.getBoundingClientRect()
			const viewRect = epub.getBoundingClientRect()
			const x = frameRect.left + rect.left + rect.width / 2
			const y = frameRect.top + rect.top + rect.height / 2
			return (
				x >= viewRect.left &&
				x < viewRect.right &&
				y >= viewRect.top &&
				y < viewRect.bottom
			)
		} catch {
			return false
		}
	}, cfi)

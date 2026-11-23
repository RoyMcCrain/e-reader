import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { describe, expect, test } from 'vite-plus/test'

import { extractCover } from '#server/cover.ts'

const ascii = (value: string) => Array.from(new TextEncoder().encode(value))
const text = (value: string) => new TextEncoder().encode(value)
const webp = Uint8Array.from([
	...ascii('RIFF'),
	4,
	0,
	0,
	0,
	...ascii('WEBP'),
	...ascii('VP8 '),
])
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const png = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
])
const gif = Uint8Array.from([...ascii('GIF89a'), 0, 0])

const zipOf = async (files: Record<string, Uint8Array>) => {
	const writer = new ZipWriter(new Uint8ArrayWriter())
	for (const [name, bytes] of Object.entries(files))
		await writer.add(name, new Uint8ArrayReader(bytes), { level: 0 })
	return writer.close()
}

const epubOf = (opf: string, files: Record<string, Uint8Array>) =>
	zipOf({
		'META-INF/container.xml': text(
			'<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		),
		'OEBPS/content.opf': text(opf),
		...files,
	})

const manifest = (items: string, meta = '') =>
	`<package><metadata>${meta}</metadata><manifest>${items}</manifest></package>`

describe('extractCover', () => {
	test('EPUB meta cover wins over the cover-image property and decodes OPF-relative hrefs', async () => {
		const opf = manifest(
			'<item id="decoy" href="decoy.jpg" media-type="image/jpeg" properties="cover-image"/><item id="cover-id" href="images/front%20cover.webp" media-type="image/webp"/>',
			'<meta name="cover" content="cover-id"/>',
		)
		const bytes = await epubOf(opf, {
			'OEBPS/decoy.jpg': jpeg,
			'OEBPS/images/front cover.webp': webp,
		})

		const cover = await extractCover(bytes, 'epub')

		expect(cover).toEqual({
			data: webp,
			contentType: 'image/webp',
			ext: 'webp',
		})
	})

	test('EPUB falls back to the cover-image property, then a cover-named file, then the first image', async () => {
		const byProperty = await epubOf(
			manifest(
				'<item id="a" href="a.png" media-type="image/png"/><item id="b" href="b.jpg" media-type="image/jpeg" properties="cover-image"/>',
			),
			{ 'OEBPS/a.png': png, 'OEBPS/b.jpg': jpeg },
		)
		const byName = await epubOf(
			manifest(
				'<item id="a" href="img/a.png" media-type="image/png"/><item id="c" href="img/cover.jpeg" media-type="image/jpeg"/>',
			),
			{ 'OEBPS/img/a.png': png, 'OEBPS/img/cover.jpeg': jpeg },
		)
		const byOrder = await epubOf(
			manifest(
				'<item id="t" href="text.xhtml" media-type="application/xhtml+xml"/><item id="z" href="img/z.png" media-type="image/png"/><item id="w" href="img/a.webp" media-type="image/webp"/>',
			),
			{ 'OEBPS/img/z.png': png, 'OEBPS/img/a.webp': webp },
		)

		expect((await extractCover(byProperty, 'epub'))?.contentType).toBe(
			'image/jpeg',
		)
		expect((await extractCover(byName, 'epub'))?.contentType).toBe('image/jpeg')
		expect(await extractCover(byOrder, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})

	test('ZIP picks the first visible image in natural filename order', async () => {
		const bytes = await zipOf({
			'10.png': png,
			'2.jpg': jpeg,
			'__MACOSX/1.jpg': webp,
			'.hidden/0.png': webp,
			'._2.jpg': webp,
			'notes.txt': gif,
		})

		const cover = await extractCover(bytes, 'zip')

		expect(cover).toEqual({
			data: jpeg,
			contentType: 'image/jpeg',
			ext: 'jpg',
		})
	})

	test('detects the format from magic bytes rather than the file extension', async () => {
		const bytes = await zipOf({ 'page.jpg': png })

		const cover = await extractCover(bytes, 'zip')

		expect(cover).toEqual({ data: png, contentType: 'image/png', ext: 'png' })
	})

	test('returns null for unsupported formats and broken archives', async () => {
		const gifEpub = await epubOf(
			manifest(
				'<item id="g" href="g.gif" media-type="image/gif"/>',
				'<meta name="cover" content="g"/>',
			),
			{ 'OEBPS/g.gif': gif },
		)
		const gifZip = await zipOf({ 'page.gif': gif })
		const noContainer = await zipOf({ 'OEBPS/content.opf': text(manifest('')) })
		const garbage = Uint8Array.from([1, 2, 3])

		expect(await extractCover(gifEpub, 'epub')).toBeNull()
		expect(await extractCover(gifZip, 'zip')).toBeNull()
		expect(await extractCover(noContainer, 'epub')).toBeNull()
		expect(await extractCover(garbage, 'epub')).toBeNull()
		expect(await extractCover(garbage, 'zip')).toBeNull()
	})

	test('ignores entries larger than the extraction caps', async () => {
		const big = new Uint8Array(600 * 1024)
		big.set(png.subarray(0, 12))
		const oversized = await zipOf({ 'cover.png': big })
		const hugeContainer = await zipOf({
			'META-INF/container.xml': new Uint8Array(2 * 1024 * 1024),
		})

		expect(await extractCover(oversized, 'zip')).toBeNull()
		expect(await extractCover(hugeContainer, 'epub')).toBeNull()
	})

	test('falls through when the cover id points at a non-image', async () => {
		const opf = manifest(
			'<item id="page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="pic" href="cover.png" media-type="image/png" properties="cover-image"/>',
			'<meta name="cover" content="page"/>',
		)
		const bytes = await epubOf(opf, {
			'OEBPS/cover.xhtml': text('<html></html>'),
			'OEBPS/cover.png': png,
		})

		expect(await extractCover(bytes, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})

	test('decodes XML entities in OPF hrefs', async () => {
		const opf = manifest(
			'<item id="c" href="im&amp;g/cover.png" media-type="image/png"/>',
			'<meta name="cover" content="c"/>',
		)
		const bytes = await epubOf(opf, { 'OEBPS/im&g/cover.png': png })

		expect(await extractCover(bytes, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})

	test('does not double-unescape XML entities in OPF hrefs', async () => {
		const opf = manifest(
			'<item id="c" href="a&amp;lt;b.png" media-type="image/png"/>',
			'<meta name="cover" content="c"/>',
		)
		const bytes = await epubOf(opf, { 'OEBPS/a&lt;b.png': png })

		expect(await extractCover(bytes, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})

	test('resolves parent-directory hrefs within the archive', async () => {
		const opf = manifest(
			'<item id="c" href="../shared/cover.png" media-type="image/png"/>',
			'<meta name="cover" content="c"/>',
		)
		const bytes = await epubOf(opf, { 'shared/cover.png': png })

		expect(await extractCover(bytes, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})

	test('handles namespace-prefixed container and OPF tags', async () => {
		const bytes = await zipOf({
			'META-INF/container.xml': text(
				'<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"><ocf:rootfiles><ocf:rootfile full-path="OEBPS/content.opf"/></ocf:rootfiles></ocf:container>',
			),
			'OEBPS/content.opf': text(
				manifest(
					'<opf:item id="c" href="cover.png" xmlns:opf="http://www.idpf.org/2007/opf"/>',
					'<opf:meta name="cover" content="c"/>',
				),
			),
			'OEBPS/cover.png': png,
		})

		expect(await extractCover(bytes, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})

	test('resolves absolute-path OPF hrefs from the archive root', async () => {
		const opf = manifest(
			'<item id="c" href="/OEBPS/cover.png" media-type="image/png"/>',
			'<meta name="cover" content="c"/>',
		)
		const bytes = await epubOf(opf, { 'OEBPS/cover.png': png })

		expect(await extractCover(bytes, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})

	test('falls back when the cover id is missing from the manifest', async () => {
		const opf = manifest(
			'<item id="b" href="b.png" media-type="image/png" properties="cover-image"/>',
			'<meta name="cover" content="gone"/>',
		)
		const bytes = await epubOf(opf, { 'OEBPS/b.png': png })

		expect(await extractCover(bytes, 'epub')).toEqual({
			data: png,
			contentType: 'image/png',
			ext: 'png',
		})
	})
})

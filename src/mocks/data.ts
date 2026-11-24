import {
	BlobWriter,
	TextReader,
	Uint8ArrayReader,
	ZipWriter,
} from '@zip.js/zip.js'

import type { CloudBook } from '#lib/library/types'

type BookSpec = Omit<CloudBook, 'id' | 'size'>

export interface MockFile {
	body: Uint8Array
	contentType: string
}

export interface MockLibrary {
	books: CloudBook[]
	files: Map<string, MockFile>
}

const bookSpecs: BookSpec[] = [
	{
		name: '巻1.zip',
		format: 'zip',
		uploadedAt: '2024-03-01T09:00:00.000Z',
		series: '星の旅',
	},
	{
		name: '巻2.zip',
		format: 'zip',
		uploadedAt: '2024-03-01T09:05:00.000Z',
		series: '星の旅',
	},
	{
		name: '巻3.zip',
		format: 'zip',
		uploadedAt: '2025-01-12T18:30:00.000Z',
		series: '星の旅',
	},
	{
		name: '上.epub',
		format: 'epub',
		uploadedAt: '2024-06-20T12:00:00.000Z',
		series: '霧の城',
		author: '水野 透',
	},
	{
		name: '下.epub',
		format: 'epub',
		uploadedAt: '2024-06-20T12:10:00.000Z',
		series: '霧の城',
		author: '水野 透',
	},
	{
		name: '海辺の図書館.epub',
		format: 'epub',
		uploadedAt: '2024-09-05T07:45:00.000Z',
		author: '藤井 さくら',
	},
	{
		name: '小さな庭.zip',
		format: 'zip',
		uploadedAt: '2024-11-18T21:10:00.000Z',
	},
	{
		name: '風の手紙.epub',
		format: 'epub',
		uploadedAt: '2025-02-03T08:00:00.000Z',
		author: '高橋 直人',
	},
	{
		name: '月明かりの市場.zip',
		format: 'zip',
		uploadedAt: '2025-04-22T10:20:00.000Z',
	},
	{
		name: '古い地図.epub',
		format: 'epub',
		uploadedAt: '2025-05-30T16:40:00.000Z',
		author: '森 志乃',
	},
	{
		name: '雨の日の喫茶店.zip',
		format: 'zip',
		uploadedAt: '2025-07-14T13:00:00.000Z',
	},
	{
		name: '午後の散歩道.epub',
		format: 'epub',
		uploadedAt: '2025-09-09T19:25:00.000Z',
		author: '白石 健',
	},
]

// Fixed entry date so rebuilt archives are byte-identical across page loads.
const mockDate = new Date(Date.UTC(2024, 0, 1))

// 1x1 PNG, the same pixel used by the Playwright history fixture.
const pixelBase64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZt8AAAAASUVORK5CYII='

const decodeBase64 = (value: string) =>
	Uint8Array.from(atob(value), (char) => char.charCodeAt(0))

export const mockZipBook = async (title: string) => {
	const pixel = decodeBase64(pixelBase64)
	const writer = new ZipWriter(new BlobWriter(), {
		lastModDate: mockDate,
		extendedTimestamp: false,
	})
	// A text entry keeps each sample's bytes unique; the reader ignores it.
	await writer.add('title.txt', new TextReader(title))
	for (const name of ['page001.png', 'page002.png', 'page003.png'])
		await writer.add(name, new Uint8ArrayReader(pixel))
	return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const escapeXml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const chapterParagraphs = () =>
	Array.from(
		{ length: 120 },
		(_, index) =>
			`<p>Paragraph ${index} ${'Mock chapter text for the development library. '.repeat(10)}</p>`,
	).join('')

export const mockEpubBook = async (title: string) => {
	// OCF requires `mimetype` first, stored, and without an extra field.
	const writer = new ZipWriter(new BlobWriter(), {
		lastModDate: mockDate,
		extendedTimestamp: false,
	})
	await writer.add('mimetype', new TextReader('application/epub+zip'), {
		level: 0,
	})
	const files = {
		'META-INF/container.xml':
			'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
		'book.opf': `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">mock-${escapeXml(title)}</dc:identifier><dc:title>${escapeXml(title)}</dc:title><dc:language>ja</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`,
		'chapter.xhtml': `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${escapeXml(title)}</title></head><body>${chapterParagraphs()}</body></html>`,
	}
	for (const [name, content] of Object.entries(files))
		await writer.add(name, new TextReader(content))
	return new Uint8Array(await (await writer.close()).arrayBuffer())
}

const sha256Hex = async (bytes: Uint8Array<ArrayBuffer>) =>
	Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
		(byte) => byte.toString(16).padStart(2, '0'),
	).join('')

const buildBook = async (spec: BookSpec) => {
	const body =
		spec.format === 'zip'
			? await mockZipBook(spec.name)
			: await mockEpubBook(spec.name)
	const id = await sha256Hex(body)
	const contentType =
		spec.format === 'zip' ? 'application/zip' : 'application/epub+zip'
	return {
		book: { ...spec, id, size: body.byteLength },
		file: [id, { body, contentType }] as const,
	}
}

const buildLibrary = async (): Promise<MockLibrary> => {
	const built = await Promise.all(bookSpecs.map(buildBook))
	return {
		books: built.map(({ book }) => book),
		files: new Map(built.map(({ file }) => file)),
	}
}

// Built once per page or test process; the cached promise prevents
// concurrent requests from generating separate copies.
let library: Promise<MockLibrary> | undefined

export const loadMockLibrary = () => (library ??= buildLibrary())

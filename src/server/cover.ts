import {
	configure,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	type FileEntry,
} from '@zip.js/zip.js'

// The server runtime cannot spawn Web Workers, so decompress on the request path.
configure({ useWebWorkers: false })

export type CoverFormat = 'epub' | 'zip'

export interface CoverImage {
	data: Uint8Array<ArrayBuffer>
	contentType: 'image/webp' | 'image/jpeg' | 'image/png'
	ext: 'webp' | 'jpg' | 'png'
}

interface ManifestItem {
	id: string
	href: string
	properties: string
}

const imagePattern = /\.(jpe?g|png|webp)$/i
const coverNamePattern = /^cover\.(jpe?g|png|webp)$/i

// Book bytes are owner-managed, but a corrupt file must not exhaust the isolate.
const metadataSizeLimit = 1_048_576
const imageSizeLimit = 524_288

const startsWith = (
	bytes: Uint8Array,
	signature: string | number[],
	offset = 0,
) => {
	const expected =
		typeof signature === 'string'
			? Array.from(new TextEncoder().encode(signature))
			: signature
	return expected.every((byte, index) => bytes[offset + index] === byte)
}
const isWebp = (bytes: Uint8Array) =>
	startsWith(bytes, 'RIFF') && startsWith(bytes, 'WEBP', 8)
const isJpeg = (bytes: Uint8Array) => startsWith(bytes, [0xff, 0xd8, 0xff])
const isPng = (bytes: Uint8Array) =>
	startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const imageKinds = [
	{ matches: isWebp, contentType: 'image/webp', ext: 'webp' },
	{ matches: isJpeg, contentType: 'image/jpeg', ext: 'jpg' },
	{ matches: isPng, contentType: 'image/png', ext: 'png' },
] as const

const detectImage = (data: Uint8Array<ArrayBuffer>): CoverImage | undefined => {
	const kind = imageKinds.find((candidate) => candidate.matches(data))
	return kind
		? { data, contentType: kind.contentType, ext: kind.ext }
		: undefined
}

const xmlEntityPattern = /&(amp|lt|gt|quot|apos);/g
const xmlEntities: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
}

// Single-pass decoding: chained replacements would double-unescape `&amp;lt;` into `<`.
const unescapeXml = (value: string) =>
	value.replace(
		xmlEntityPattern,
		(entity) => xmlEntities[entity.slice(1, -1)] ?? entity,
	)

const attributes = (source: string) =>
	new Map(
		[...source.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)].map((match) => [
			match[1],
			unescapeXml(match[3]),
		]),
	)

const manifestItems = (opf: string): ManifestItem[] =>
	[...opf.matchAll(/<(?:[\w-]+:)?item\b([^>]*)>/gi)].map((match) => {
		const attrs = attributes(match[1])
		return {
			id: attrs.get('id') ?? '',
			href: attrs.get('href') ?? '',
			properties: attrs.get('properties') ?? '',
		}
	})

const metaCoverId = (opf: string) =>
	[...opf.matchAll(/<(?:[\w-]+:)?meta\b([^>]*)>/gi)]
		.map((match) => attributes(match[1]))
		.find((attrs) => attrs.get('name') === 'cover')
		?.get('content')

const baseName = (path: string) => path.split('/').at(-1) ?? ''

const candidateHrefs = (items: ManifestItem[], coverId: string | undefined) => {
	const byId = coverId ? items.find((item) => item.id === coverId) : undefined
	const ordered = [
		byId,
		items.find((item) => item.properties.split(/\s+/).includes('cover-image')),
		items.find((item) => coverNamePattern.test(baseName(item.href))),
		items.find((item) => imagePattern.test(item.href)),
	]
	return [
		...new Set(
			ordered.filter((item) => item !== undefined).map((item) => item.href),
		),
	]
}

const joinPath = (base: string[], href: string) =>
	[...base, ...href.split('/').map(decodeURIComponent)]
		.reduce<string[]>((parts, part) => {
			if (part === '..') return parts.slice(0, -1)
			if (part === '' || part === '.') return parts
			return [...parts, part]
		}, [])
		.join('/')

const isHiddenPath = (path: string) =>
	path.split('/').some((part) => part === '__MACOSX' || part.startsWith('.'))

const byNaturalName = (a: FileEntry, b: FileEntry) =>
	a.filename.localeCompare(b.filename, undefined, {
		numeric: true,
		sensitivity: 'base',
	})

const readFileEntries = async (bytes: Uint8Array) => {
	const reader = new ZipReader(new Uint8ArrayReader(bytes))
	return (await reader.getEntries()).filter(
		(entry): entry is FileEntry => !entry.directory,
	)
}

const readBytes = (entry: FileEntry, cap: number) => {
	if (
		!Number.isSafeInteger(entry.uncompressedSize) ||
		entry.uncompressedSize < 1 ||
		entry.uncompressedSize > cap
	)
		return Promise.resolve(undefined)
	return entry.getData(new Uint8ArrayWriter())
}

const readText = async (entry: FileEntry) => {
	const bytes = await readBytes(entry, metadataSizeLimit)
	return bytes === undefined ? undefined : new TextDecoder().decode(bytes)
}

const findEntry = (entries: FileEntry[], path: string) =>
	entries.find((entry) => entry.filename === path)

const opfPathOf = async (entries: FileEntry[]) => {
	const container = findEntry(entries, 'META-INF/container.xml')
	if (!container) return undefined
	const xml = await readText(container)
	if (xml === undefined) return undefined
	const rootfile = /<(?:[\w-]+:)?rootfile\b([^>]*)>/i.exec(xml)
	return attributes(rootfile?.[1] ?? '').get('full-path')
}

const epubCover = async (entries: FileEntry[]) => {
	const opfPath = await opfPathOf(entries)
	if (opfPath === undefined) return undefined
	const opfEntry = findEntry(entries, opfPath)
	if (!opfEntry) return undefined
	const opf = await readText(opfEntry)
	if (opf === undefined) return undefined
	const base = opfPath.split('/').slice(0, -1)
	for (const href of candidateHrefs(manifestItems(opf), metaCoverId(opf))) {
		// Absolute hrefs resolve from the archive root, not the OPF directory.
		const entry = findEntry(
			entries,
			joinPath(href.startsWith('/') ? [] : base, href),
		)
		if (!entry) continue
		const bytes = await readBytes(entry, imageSizeLimit)
		if (!bytes) continue
		const cover = detectImage(bytes)
		if (cover) return cover
	}
	return undefined
}

const zipCover = async (entries: FileEntry[]) => {
	const first = entries
		.filter(
			(entry) =>
				!isHiddenPath(entry.filename) &&
				imagePattern.test(baseName(entry.filename)),
		)
		.sort(byNaturalName)
		.at(0)
	if (!first) return undefined
	const bytes = await readBytes(first, imageSizeLimit)
	return bytes ? detectImage(bytes) : undefined
}

export const extractCover = async (
	bytes: Uint8Array,
	format: CoverFormat,
): Promise<CoverImage | null> => {
	try {
		const entries = await readFileEntries(bytes)
		const cover =
			format === 'epub' ? await epubCover(entries) : await zipCover(entries)
		return cover ?? null
	} catch {
		return null
	}
}

import { parseAuthorName, validBookMetadata } from '#lib/library/metadata.ts'
import type { LibraryResponse, CloudBook } from '#lib/library/types'
import { checkAccess, type AccessEnv } from '#server/access.ts'
import { extractCover, type CoverImage } from '#server/cover.ts'

interface StoredObject {
	body: ReadableStream<Uint8Array> | null
	size: number
}

interface R2BucketLike {
	get(key: string): Promise<(StoredObject & { text(): Promise<string> }) | null>
	put(key: string, value: Uint8Array): Promise<unknown>
}

export interface LibraryEnv extends AccessEnv {
	BOOKS: R2BucketLike
}

const baseHeaders = {
	'Cache-Control': 'private, no-store',
	'X-Content-Type-Options': 'nosniff',
}
const idPattern = /^[a-f0-9]{64}$/
const bookAssetPattern = /^\/api\/books\/([a-f0-9]{64})(\/cover)?$/
const coverSizeLimit = 524_288
// Generation reads the whole book into memory, so larger books are not eligible.
const generationSizeLimit = 33_554_432
const storedCoverKinds = [
	{ ext: 'webp', contentType: 'image/webp' },
	{ ext: 'jpg', contentType: 'image/jpeg' },
	{ ext: 'png', contentType: 'image/png' },
] as const
// Control bytes are forbidden in filenames at both validation boundaries.
// oxlint-disable-next-line no-control-regex
const filenamePattern = /^[^/\\\u0000-\u001f\u007f]{1,240}$/u

const response = (
	body: BodyInit | null,
	status: number,
	headers: Record<string, string> = {},
) => new Response(body, { status, headers: { ...baseHeaders, ...headers } })

const validIdentity = (book: Record<string, unknown>) =>
	typeof book.id === 'string' &&
	idPattern.test(book.id) &&
	(book.format === 'epub' || book.format === 'zip')

const validName = (book: Record<string, unknown>) =>
	typeof book.name === 'string' &&
	filenamePattern.test(book.name) &&
	// oxlint-disable-next-line no-control-regex
	!/[\u0000-\u001f\u007f]/u.test(book.name) &&
	(book.format === 'epub' || book.format === 'zip') &&
	book.name.toLowerCase().endsWith(`.${book.format}`)

const validSize = (size: unknown) =>
	typeof size === 'number' && Number.isSafeInteger(size) && size > 0

type ManifestBook = Omit<CloudBook, 'author'> & { author?: unknown }

const validBook = (value: unknown): value is ManifestBook => {
	if (!value || typeof value !== 'object') return false
	const book = value as Record<string, unknown>
	return (
		validIdentity(book) &&
		validName(book) &&
		validSize(book.size) &&
		validBookMetadata(book)
	)
}

const parseManifest = (text: string): LibraryResponse | null => {
	const manifest: unknown = JSON.parse(text)
	if (!manifest || typeof manifest !== 'object') return null
	const books = (manifest as { books?: unknown }).books
	if (!Array.isArray(books) || books.length > 10_000 || !books.every(validBook))
		return null
	const ids = books.map((book) => book.id)
	return new Set(ids).size === books.length
		? {
				books: books.map((book) => {
					const {
						id,
						name,
						format,
						size,
						series,
						uploadedAt,
						hasCover,
						author,
					} = book
					const authorName = parseAuthorName(author)
					return {
						id,
						name,
						format,
						size,
						...(series === undefined ? {} : { series: series.trim() }),
						...(uploadedAt === undefined ? {} : { uploadedAt }),
						...(hasCover === undefined ? {} : { hasCover }),
						...(authorName === undefined ? {} : { author: authorName }),
					}
				}),
			}
		: null
}

const readManifest = async (
	bucket: R2BucketLike,
): Promise<LibraryResponse | null> => {
	const object = await bucket.get('library.json')
	if (!object) return { books: [] }
	if (!Number.isSafeInteger(object.size) || object.size > 4 * 1024 * 1024)
		return null
	try {
		return parseManifest(await object.text())
	} catch {
		return null
	}
}

const encodedFilename = (name: string) =>
	encodeURIComponent(name).replace(
		/[!'()*]/g,
		(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
	)

const downloadBook = async (bucket: R2BucketLike, book: CloudBook) => {
	const object = await bucket.get(`books/${book.id}.${book.format}`)
	if (!object?.body) return response('Not found', 404)
	return response(object.body, 200, {
		'Content-Type':
			book.format === 'epub' ? 'application/epub+zip' : 'application/zip',
		'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename(book.name)}`,
		'Content-Length': String(object.size),
	})
}

const coverHeaders = (size: number, contentType: string) => ({
	'Content-Type': contentType,
	'Content-Length': String(size),
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Content-Security-Policy': "default-src 'none'; sandbox",
})

const validCoverSize = (size: number) =>
	Number.isSafeInteger(size) && size >= 1 && size <= coverSizeLimit

// Reads a cover only when its declared size is in range; otherwise cancels it.
const readCoverObject = async (bucket: R2BucketLike, key: string) => {
	const object = await bucket.get(key)
	if (!object?.body) return undefined
	if (!validCoverSize(object.size)) {
		await object.body.cancel().catch(() => undefined)
		return undefined
	}
	return new Uint8Array(await new Response(object.body).arrayBuffer())
}

const ascii = (data: Uint8Array, start: number) =>
	String.fromCharCode(...data.subarray(start, start + 4))

// Manual covers are only checked for the WebP signature; generated ones are trusted.
const isWebpBytes = (data: Uint8Array) =>
	ascii(data, 0) === 'RIFF' && ascii(data, 8) === 'WEBP'

const storedCover = async (bucket: R2BucketLike, id: string) => {
	for (const kind of storedCoverKinds) {
		const data = await readCoverObject(bucket, `covers/${id}.${kind.ext}`)
		if (!data) continue
		if (kind.ext !== 'webp' || isWebpBytes(data))
			return { data, contentType: kind.contentType }
	}
	return undefined
}

const readBookForCover = async (bucket: R2BucketLike, book: CloudBook) => {
	const object = await bucket.get(`books/${book.id}.${book.format}`)
	if (!object?.body) return undefined
	if (
		!Number.isSafeInteger(object.size) ||
		object.size < 1 ||
		object.size > generationSizeLimit
	) {
		await object.body.cancel().catch(() => undefined)
		return undefined
	}
	return new Uint8Array(await new Response(object.body).arrayBuffer())
}

// Best-effort save: a failed write must not block serving the extracted cover.
// The manifest is never rewritten; it is owner-managed configuration.
const saveGeneratedCover = async (
	bucket: R2BucketLike,
	id: string,
	cover: CoverImage,
) => {
	if (!validCoverSize(cover.data.byteLength)) return
	if (cover.ext === 'webp') {
		// Never overwrite an owner-placed webp, even when it fails the signature check.
		const existing = await bucket.get(`covers/${id}.webp`)
		if (existing?.body) {
			await existing.body.cancel().catch(() => undefined)
			return
		}
	}
	await bucket
		.put(`covers/${id}.${cover.ext}`, cover.data)
		.catch(() => undefined)
}

const generateCover = async (bucket: R2BucketLike, book: CloudBook) => {
	const bytes = await readBookForCover(bucket, book)
	if (!bytes) return undefined
	const cover = await extractCover(bytes, book.format)
	if (!cover) return undefined
	await saveGeneratedCover(bucket, book.id, cover)
	return cover
}

const serveCoverImage = (cover: {
	data: Uint8Array<ArrayBuffer>
	contentType: string
}) =>
	response(
		cover.data,
		200,
		coverHeaders(cover.data.byteLength, cover.contentType),
	)

// Marked covers stream straight from R2 as before; only the size is checked.
const serveMarkedCover = async (bucket: R2BucketLike, book: CloudBook) => {
	const object = await bucket.get(`covers/${book.id}.webp`)
	if (!object?.body) return response('Not found', 404)
	if (!validCoverSize(object.size)) {
		await object.body.cancel().catch(() => undefined)
		return response('Not found', 404)
	}
	return response(object.body, 200, coverHeaders(object.size, 'image/webp'))
}

const serveCover = async (bucket: R2BucketLike, book: CloudBook) => {
	if (book.hasCover === true) return serveMarkedCover(bucket, book)
	const cover =
		(await storedCover(bucket, book.id)) ?? (await generateCover(bucket, book))
	return cover ? serveCoverImage(cover) : response('Not found', 404)
}

const serveBookAsset = async (bucket: R2BucketLike, pathname: string) => {
	const match = bookAssetPattern.exec(pathname)
	if (!match) return response('Not found', 404)
	const manifest = await readManifest(bucket)
	if (!manifest) return response('Service unavailable', 503)
	const book = manifest.books.find((entry) => entry.id === match[1])
	if (!book) return response('Not found', 404)
	return match[2] ? serveCover(bucket, book) : downloadBook(bucket, book)
}

const serveLibrary = async (
	request: Request,
	env: LibraryEnv,
	pathname: string,
) => {
	try {
		if (request.method !== 'GET')
			return response('Method not allowed', 405, { Allow: 'GET' })
		if (pathname === '/api/books') {
			const manifest = await readManifest(env.BOOKS)
			return manifest
				? response(JSON.stringify(manifest), 200, {
						'Content-Type': 'application/json; charset=utf-8',
					})
				: response('Invalid library manifest', 503)
		}
		return await serveBookAsset(env.BOOKS, pathname)
	} catch {
		return response('Service unavailable', 503)
	}
}

export const handleLibrary = async (request: Request, env: LibraryEnv) => {
	const { pathname } = new URL(request.url)
	if (pathname !== '/api/books' && !pathname.startsWith('/api/books/'))
		return response('Not found', 404)
	const authStatus = await checkAccess(request, env)
	if (authStatus !== 200)
		return response(
			authStatus === 503 ? 'Service unavailable' : 'Unauthorized',
			authStatus,
		)
	return serveLibrary(request, env, pathname)
}

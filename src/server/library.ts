import { validBookMetadata } from '#lib/library/metadata.ts'
import type { LibraryResponse, CloudBook } from '#lib/library/types'
import { checkAccess, type AccessEnv } from '#server/access.ts'

interface StoredObject {
	body: ReadableStream<Uint8Array> | null
	size: number
}

interface R2BucketLike {
	get(key: string): Promise<(StoredObject & { text(): Promise<string> }) | null>
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

const validBook = (value: unknown): value is CloudBook => {
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
	if (!Array.isArray(books) || books.length > 5_000 || !books.every(validBook))
		return null
	const ids = books.map((book) => (book as CloudBook).id)
	return new Set(ids).size === books.length
		? {
				books: books.map((book) => {
					const { id, name, format, size, series, uploadedAt, hasCover } =
						book as CloudBook
					return {
						id,
						name,
						format,
						size,
						...(series === undefined ? {} : { series: series.trim() }),
						...(uploadedAt === undefined ? {} : { uploadedAt }),
						...(hasCover === undefined ? {} : { hasCover }),
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
	if (!Number.isSafeInteger(object.size) || object.size > 1_048_576) return null
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

const coverHeaders = (size: number) => ({
	'Content-Type': 'image/webp',
	'Content-Length': String(size),
	'Cross-Origin-Resource-Policy': 'same-origin',
	'Content-Security-Policy': "default-src 'none'; sandbox",
})

const serveCover = async (bucket: R2BucketLike, book: CloudBook) => {
	if (book.hasCover !== true) return response('Not found', 404)
	const object = await bucket.get(`covers/${book.id}.webp`)
	if (!object?.body) return response('Not found', 404)
	if (
		!Number.isSafeInteger(object.size) ||
		object.size < 1 ||
		object.size > coverSizeLimit
	) {
		await object.body.cancel().catch(() => undefined)
		return response('Not found', 404)
	}
	return response(object.body, 200, coverHeaders(object.size))
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

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
	return validIdentity(book) && validName(book) && validSize(book.size)
}

const parseManifest = (text: string): LibraryResponse | null => {
	const manifest: unknown = JSON.parse(text)
	if (!manifest || typeof manifest !== 'object') return null
	const books = (manifest as { books?: unknown }).books
	if (!Array.isArray(books) || books.length > 1000 || !books.every(validBook))
		return null
	const ids = books.map((book) => (book as CloudBook).id)
	return new Set(ids).size === books.length
		? {
				books: books.map((book) => {
					const { id, name, format, size } = book as CloudBook
					return { id, name, format, size }
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

		const match = /^\/api\/books\/([a-f0-9]{64})$/.exec(pathname)
		if (!match) return response('Not found', 404)
		const manifest = await readManifest(env.BOOKS)
		if (!manifest) return response('Service unavailable', 503)
		const book = manifest.books.find((entry) => entry.id === match[1])
		return book
			? await downloadBook(env.BOOKS, book)
			: response('Not found', 404)
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

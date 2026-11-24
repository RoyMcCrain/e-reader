import { createHash } from 'node:crypto'

import {
	FileEntry,
	TextWriter,
	Uint8ArrayReader,
	ZipReader,
} from '@zip.js/zip.js'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { handlers, resetMockPositions } from '#mocks/handlers'

const server = setupServer(...handlers)
const origin = 'http://localhost'

const chapterCfi = 'epubcfi(/6/2!/4/2/1:0)'
const otherCfi = 'epubcfi(/6/2!/4/2/3:0)'
const firstMutationId = '11111111-1111-4111-8111-111111111111'
const secondMutationId = '22222222-2222-4222-8222-222222222222'

interface MockBook {
	id: string
	name: string
	format: 'epub' | 'zip'
	size: number
}

interface StoredPosition {
	cfi: string
	revision: number
	mutationId: string
	updatedAt: number
}

interface ListBody {
	positions: { bookId: string; updatedAt: number }[]
}

const sha256 = (bytes: Uint8Array) =>
	createHash('sha256').update(bytes).digest('hex')

const getJson = async <T>(path: string) => {
	const response = await fetch(`${origin}${path}`)
	return { status: response.status, body: (await response.json()) as T }
}

const getBytes = async (path: string) =>
	new Uint8Array(await (await fetch(`${origin}${path}`)).arrayBuffer())

const listBooks = async () =>
	(await getJson<{ books: MockBook[] }>('/api/books')).body.books

const listPositions = async () =>
	(await getJson<ListBody>('/api/reading-positions')).body.positions

const unreadBookId = async () => {
	const read = new Set((await listPositions()).map((item) => item.bookId))
	const unread = (await listBooks()).find((book) => !read.has(book.id))
	if (!unread) throw new Error('no unread sample book')
	return unread.id
}

const putPosition = (bookId: string, payload: unknown) =>
	fetch(`${origin}/api/reading-positions/${bookId}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload),
	})

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => resetMockPositions())

describe('mock library books', () => {
	it('serves bytes whose hash and size match each listed book', async () => {
		const books = await listBooks()
		const bytesById = new Map(
			await Promise.all(
				books.map(
					async (book) =>
						[book.id, await getBytes(`/api/books/${book.id}`)] as const,
				),
			),
		)

		expect(new Set(books.map((book) => book.id)).size).toBe(books.length)
		for (const book of books) {
			const bytes = bytesById.get(book.id)!
			expect(sha256(bytes)).toBe(book.id)
			expect(bytes.byteLength).toBe(book.size)
		}
	})

	it('lists every sample book with a matching extension', async () => {
		const books = await listBooks()

		for (const book of books)
			expect(book.name.endsWith(`.${book.format}`)).toBe(true)
	})

	it('serves a mock EPUB with a stored first mimetype entry and paragraph chapter', async () => {
		const epub = (await listBooks()).find((book) => book.format === 'epub')!
		const reader = new ZipReader(
			new Uint8ArrayReader(await getBytes(`/api/books/${epub.id}`)),
		)
		const entries = (await reader.getEntries()) as FileEntry[]
		const [mimetype] = entries
		const chapter = entries.find((entry) => entry.filename === 'chapter.xhtml')!

		expect(mimetype?.filename).toBe('mimetype')
		expect(mimetype?.compressionMethod).toBe(0)
		expect(await mimetype?.getData(new TextWriter())).toBe(
			'application/epub+zip',
		)
		expect(await chapter.getData(new TextWriter())).toContain(
			'<body><p>Paragraph 0 ',
		)
		await reader.close()
	})
})

describe('mock reading positions', () => {
	it('lists seeded positions as Unix seconds matching the single-position read', async () => {
		const bookIds = (await listBooks()).map((book) => book.id)
		const positions = await listPositions()
		const updatedAt = positions.map((item) => item.updatedAt)
		const nowSeconds = Date.now() / 1000

		expect(positions.length).toBeGreaterThan(0)
		expect(updatedAt).toEqual([...updatedAt].sort((a, b) => b - a))
		for (const item of positions) {
			const { body } = await getJson<{ position: StoredPosition | null }>(
				`/api/reading-positions/${item.bookId}`,
			)
			expect(bookIds).toContain(item.bookId)
			expect(body.position?.updatedAt).toBe(item.updatedAt)
			expect(item.updatedAt).toBeLessThanOrEqual(nowSeconds)
		}
	})

	it('treats a missing position as revision 0 and rejects a nonzero base with null', async () => {
		const bookId = await unreadBookId()

		const response = await putPosition(bookId, {
			cfi: chapterCfi,
			baseRevision: 1,
			mutationId: firstMutationId,
		})

		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({ position: null })
	})

	it('stores a first write from revision 0 and lists it with the single-read seconds', async () => {
		const bookId = await unreadBookId()

		const response = await putPosition(bookId, {
			cfi: chapterCfi,
			baseRevision: 0,
			mutationId: firstMutationId,
		})
		const { body: single } = await getJson<{
			position: StoredPosition | null
		}>(`/api/reading-positions/${bookId}`)
		const positions = await listPositions()

		expect(response.status).toBe(200)
		expect(single.position?.revision).toBe(1)
		expect(positions[0]).toEqual({
			bookId,
			updatedAt: single.position?.updatedAt,
		})
	})

	it('replays the same mutation as 200 and a different cfi under it as 409', async () => {
		const bookId = await unreadBookId()
		await putPosition(bookId, {
			cfi: chapterCfi,
			baseRevision: 0,
			mutationId: firstMutationId,
		})

		const replay = await putPosition(bookId, {
			cfi: chapterCfi,
			baseRevision: 0,
			mutationId: firstMutationId,
		})
		const conflicting = await putPosition(bookId, {
			cfi: otherCfi,
			baseRevision: 0,
			mutationId: firstMutationId,
		})

		expect(replay.status).toBe(200)
		expect(conflicting.status).toBe(409)
	})

	it('rejects a stale base revision with the current stored position', async () => {
		const bookId = await unreadBookId()
		await putPosition(bookId, {
			cfi: chapterCfi,
			baseRevision: 0,
			mutationId: firstMutationId,
		})

		const response = await putPosition(bookId, {
			cfi: otherCfi,
			baseRevision: 0,
			mutationId: secondMutationId,
		})

		const { position } = (await response.json()) as {
			position: StoredPosition
		}
		expect(response.status).toBe(409)
		expect(position.revision).toBe(1)
		expect(position.cfi).toBe(chapterCfi)
	})
})

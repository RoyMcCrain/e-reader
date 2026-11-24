import { http, HttpResponse } from 'msw'

import { loadMockLibrary } from '#mocks/data'

interface StoredPosition {
	cfi: string
	revision: number
	mutationId: string
	updatedAt: number
}

interface Mutation {
	cfi: string
	baseRevision: number
	mutationId: string
}

const seedAgo = [
	[1, 2 * 60 * 60 * 1000],
	[4, 26 * 60 * 60 * 1000],
	[6, 3 * 24 * 60 * 60 * 1000],
	[2, 5 * 24 * 60 * 60 * 1000],
	[9, 9 * 24 * 60 * 60 * 1000],
	[7, 20 * 24 * 60 * 60 * 1000],
	[3, 40 * 24 * 60 * 60 * 1000],
] as const

const seedCfi = 'epubcfi(/6/2!/4/2/1:0)'
const seedMutationId = '00000000-0000-4000-8000-000000000001'

const positions = new Map<string, StoredPosition>()

// Resolves once the seeded positions exist; handlers await it so a request
// arriving during the async seed never sees an empty or half-built store.
let seeded: Promise<void> = Promise.resolve()

const seed = async () => {
	const { books } = await loadMockLibrary()
	const now = Date.now()
	const entries = seedAgo.map(
		([index, ago]) =>
			[
				books[index - 1]!.id,
				{
					cfi: seedCfi,
					revision: 1,
					mutationId: seedMutationId,
					updatedAt: Math.floor((now - ago) / 1000),
				},
			] as const,
	)
	positions.clear()
	for (const [bookId, position] of entries) positions.set(bookId, position)
}

export const resetMockPositions = () => {
	seeded = seed()
	return seeded
}

seeded = seed()

const isMutation = (value: unknown): value is Mutation => {
	if (typeof value !== 'object' || value === null) return false
	const { cfi, baseRevision, mutationId } = value as Record<string, unknown>
	return (
		typeof cfi === 'string' &&
		typeof mutationId === 'string' &&
		typeof baseRevision === 'number' &&
		Number.isSafeInteger(baseRevision) &&
		baseRevision >= 0
	)
}

const readMutation = async (request: Request) => {
	const body: unknown = await request.json().catch(() => undefined)
	return isMutation(body) ? body : undefined
}

const idOf = (params: Record<string, string | readonly string[] | undefined>) =>
	String(params.id)

const listPositions = async () => {
	await seeded
	const items = [...positions.entries()]
		.map(([bookId, position]) => ({ bookId, updatedAt: position.updatedAt }))
		.sort(
			(left, right) =>
				right.updatedAt - left.updatedAt ||
				left.bookId.localeCompare(right.bookId),
		)
	return HttpResponse.json({ positions: items })
}

const getPosition = async (bookId: string) => {
	await seeded
	return HttpResponse.json({ position: positions.get(bookId) ?? null })
}

// Mirrors the server replay: the same mutation id answers from the stored row.
const replayOrConflict = (stored: StoredPosition, mutation: Mutation) =>
	stored.cfi === mutation.cfi
		? HttpResponse.json({ position: stored })
		: HttpResponse.json({ position: stored }, { status: 409 })

const putPosition = async (bookId: string, request: Request) => {
	await seeded
	const mutation = await readMutation(request)
	if (!mutation)
		return HttpResponse.json({ error: 'invalid payload' }, { status: 400 })
	const stored = positions.get(bookId)
	if (stored?.mutationId === mutation.mutationId)
		return replayOrConflict(stored, mutation)
	// A missing position counts as revision 0.
	const revision = stored?.revision ?? 0
	if (revision !== mutation.baseRevision)
		return HttpResponse.json({ position: stored ?? null }, { status: 409 })
	const position = {
		cfi: mutation.cfi,
		revision: revision + 1,
		mutationId: mutation.mutationId,
		updatedAt: Math.floor(Date.now() / 1000),
	}
	positions.set(bookId, position)
	return HttpResponse.json({ position })
}

const bookFile = async (id: string) => {
	const { files } = await loadMockLibrary()
	return files.get(id)
}

export const handlers = [
	http.get('*/api/books', async () =>
		HttpResponse.json({ books: (await loadMockLibrary()).books }),
	),
	http.get('*/api/books/:id/cover', () =>
		HttpResponse.text('Not found', { status: 404 }),
	),
	http.get('*/api/books/:id', async ({ params }) => {
		const file = await bookFile(idOf(params))
		if (!file) return HttpResponse.text('Not found', { status: 404 })
		return new HttpResponse(file.body, {
			headers: { 'Content-Type': file.contentType },
		})
	}),
	http.get('*/api/reading-positions', listPositions),
	http.get('*/api/reading-positions/:id', ({ params }) =>
		getPosition(idOf(params)),
	),
	http.put('*/api/reading-positions/:id', ({ params, request }) =>
		putPosition(idOf(params), request),
	),
]

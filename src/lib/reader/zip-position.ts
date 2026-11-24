export const ZIP_POSITIONS_KEY = 'shiori.reader.zip-positions.v1'

const MAX_BOOKS = 200

interface ZipPosition {
	lead: number
	updatedAt: number
}
type ZipPositions = Record<string, ZipPosition>

const validBookId = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
const validIndex = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) >= 0

const validPosition = (value: unknown): value is ZipPosition =>
	value !== null &&
	typeof value === 'object' &&
	validIndex((value as ZipPosition).lead) &&
	Number.isFinite((value as ZipPosition).updatedAt)

const readAll = (): ZipPositions => {
	try {
		const stored = globalThis.localStorage?.getItem(ZIP_POSITIONS_KEY)
		const parsed: unknown = stored ? JSON.parse(stored) : {}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return {}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				([key, value]) => validBookId(key) && validPosition(value),
			),
		)
	} catch {
		return {}
	}
}

// Oldest first; ties keep insertion order, so the book just written survives.
const writeAll = (positions: ZipPositions) => {
	const entries = Object.entries(positions).sort(
		([, left], [, right]) => left.updatedAt - right.updatedAt,
	)
	try {
		globalThis.localStorage?.setItem(
			ZIP_POSITIONS_KEY,
			JSON.stringify(Object.fromEntries(entries.slice(-MAX_BOOKS))),
		)
	} catch {
		// Storage can be disabled or full; the reader still opens from page one.
	}
}

export const loadZipLead = (
	bookId: string,
	count: number,
): number | undefined => {
	if (!validBookId(bookId) || !validIndex(count) || count <= 0) return undefined
	const saved = readAll()[bookId]
	if (!saved || !validIndex(saved.lead)) return undefined
	return Math.min(saved.lead, count - 1)
}

export const saveZipLead = (bookId: string, lead: number): void => {
	if (!validBookId(bookId) || !validIndex(lead)) return
	const positions = readAll()
	delete positions[bookId]
	positions[bookId] = { lead, updatedAt: Date.now() }
	writeAll(positions)
}

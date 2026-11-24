export interface LastSession {
	bookId: string
	name: string
	format: 'epub' | 'zip'
	updatedAt: number
}

export const LAST_SESSION_KEY = 'shiori.reader.last-session.v1'

const validBookId = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
const validName = (value: unknown): value is string =>
	typeof value === 'string' && value.length >= 1 && value.length <= 255
const validFormat = (value: unknown): value is LastSession['format'] =>
	value === 'epub' || value === 'zip'
const validUpdatedAt = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) >= 0

const normalize = (value: unknown): LastSession | undefined => {
	if (!value || typeof value !== 'object') return undefined
	const row = value as Record<string, unknown>
	if (
		!validBookId(row.bookId) ||
		!validName(row.name) ||
		!validFormat(row.format) ||
		!validUpdatedAt(row.updatedAt)
	)
		return undefined
	return {
		bookId: row.bookId,
		name: row.name,
		format: row.format,
		updatedAt: row.updatedAt,
	}
}

export const readLastSession = (): LastSession | undefined => {
	try {
		const stored = globalThis.localStorage?.getItem(LAST_SESSION_KEY)
		return stored ? normalize(JSON.parse(stored)) : undefined
	} catch {
		return undefined
	}
}

export const writeLastSession = (value: {
	bookId: string
	name: string
	format: LastSession['format']
}): void => {
	if (!validBookId(value.bookId) || !validName(value.name)) return
	if (!validFormat(value.format)) return
	try {
		globalThis.localStorage?.setItem(
			LAST_SESSION_KEY,
			JSON.stringify({ ...value, updatedAt: Date.now() }),
		)
	} catch {
		// Storage can be disabled or full; resume is best-effort.
	}
}

export const clearLastSession = (): void => {
	try {
		globalThis.localStorage?.removeItem(LAST_SESSION_KEY)
	} catch {
		// Storage can be disabled; nothing to clear.
	}
}

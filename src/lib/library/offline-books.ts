import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface OfflineSave {
	bookId: string
	name: string
	format: 'epub' | 'zip'
	size: number
	blob: Blob
	savedAt: number
}
interface OfflineBookDatabase extends DBSchema {
	books: { key: string; value: OfflineSave }
}

const mimeTypes = {
	epub: 'application/epub+zip',
	zip: 'application/zip',
} as const

let connection: Promise<IDBPDatabase<OfflineBookDatabase>> | undefined
const validId = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
const validFormat = (value: unknown): value is OfflineSave['format'] =>
	value === 'epub' || value === 'zip'
const validSize = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0
const validSavedAt = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) > 0

const validName = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0
const validSaveFields = (
	row: Record<string, unknown>,
): row is Record<string, unknown> & OfflineSave =>
	validId(row.bookId) &&
	validName(row.name) &&
	validFormat(row.format) &&
	validSize(row.size) &&
	row.blob instanceof Blob &&
	validSavedAt(row.savedAt)

const parseSave = (value: unknown): OfflineSave | undefined => {
	if (!value || typeof value !== 'object') return undefined
	const row = value as Record<string, unknown>
	if (!validSaveFields(row)) return undefined
	return {
		bookId: row.bookId,
		name: row.name,
		format: row.format,
		size: row.size,
		blob: row.blob,
		savedAt: row.savedAt,
	}
}

const database = () => {
	if (typeof indexedDB === 'undefined')
		return Promise.reject(new Error('IndexedDB unavailable'))
	connection ??= openDB<OfflineBookDatabase>('reader-offline-books', 1, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('books'))
				db.createObjectStore('books', { keyPath: 'bookId' })
		},
		blocking() {
			void connection?.then((db) => db.close())
			connection = undefined
		},
		terminated() {
			connection = undefined
		},
	}).catch((error: unknown) => {
		connection = undefined
		throw error
	})
	return connection
}

export const listOfflineSaves = async (): Promise<OfflineSave[]> => {
	const db = await database()
	return (await db.getAll('books'))
		.map(parseSave)
		.filter((save): save is OfflineSave => save !== undefined)
		.sort((left, right) => right.savedAt - left.savedAt)
}

export const saveOfflineBook = async (
	book: { id: string; name: string; format: 'epub' | 'zip'; size: number },
	blob: Blob,
): Promise<void> => {
	const save = parseSave({
		bookId: book.id,
		name: book.name,
		format: book.format,
		size: blob.size,
		blob,
		savedAt: Date.now(),
	})
	if (!save) throw new Error('Invalid offline book')
	const db = await database()
	await db.put('books', save)
}

export const loadOfflineFile = async (
	bookId: string,
): Promise<File | undefined> => {
	if (!validId(bookId)) return undefined
	const db = await database()
	const save = parseSave(await db.get('books', bookId))
	if (!save) return undefined
	return new File([save.blob], save.name, { type: mimeTypes[save.format] })
}

export const removeOfflineBook = async (bookId: string): Promise<void> => {
	if (!validId(bookId)) return
	const db = await database()
	await db.delete('books', bookId)
}

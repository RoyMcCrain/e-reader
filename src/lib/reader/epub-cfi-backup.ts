// Synchronous backup of the last confirmed EPUB CFI. IndexedDB (positions.ts)
// stays the source of truth; this copy only covers the window where the tab is
// killed between an IndexedDB write and its completion, since those async writes
// cannot be awaited during unload.
export const EPUB_CFI_BACKUP_KEY = 'shiori.reader.epub-cfi-backup.v1'

const MAX_BOOKS = 200

interface CfiBackup {
	cfi: string
	updatedAt: number
}
type CfiBackups = Record<string, CfiBackup>

const validBookId = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
const validCFI = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 4096 &&
	/^epubcfi\(.+\)$/u.test(value)

const validBackup = (value: unknown): value is CfiBackup =>
	value !== null &&
	typeof value === 'object' &&
	validCFI((value as CfiBackup).cfi) &&
	Number.isFinite((value as CfiBackup).updatedAt)

const readAll = (): CfiBackups => {
	try {
		const stored = globalThis.localStorage?.getItem(EPUB_CFI_BACKUP_KEY)
		const parsed: unknown = stored ? JSON.parse(stored) : {}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
			return {}
		return Object.fromEntries(
			Object.entries(parsed).filter(
				([key, value]) => validBookId(key) && validBackup(value),
			),
		)
	} catch {
		return {}
	}
}

// Backup is written synchronously before the async IndexedDB write starts, so a
// differing backup means the IndexedDB write never finished. IndexedDB is still
// the source of truth whenever no backup exists.
export const selectInitialCfi = (
	saved: string | undefined,
	backup: string | undefined,
): string | undefined => backup ?? saved

// Oldest first; ties keep insertion order, so the book just written survives.
const writeAll = (backups: CfiBackups) => {
	const entries = Object.entries(backups).sort(
		([, left], [, right]) => left.updatedAt - right.updatedAt,
	)
	try {
		globalThis.localStorage?.setItem(
			EPUB_CFI_BACKUP_KEY,
			JSON.stringify(Object.fromEntries(entries.slice(-MAX_BOOKS))),
		)
	} catch {
		// Storage can be disabled or full; IndexedDB remains the record.
	}
}

export const loadEpubCfiBackup = (bookId: string): string | undefined => {
	if (!validBookId(bookId)) return undefined
	const saved = readAll()[bookId]
	return validCFI(saved?.cfi) ? saved.cfi : undefined
}

export const saveEpubCfiBackup = (bookId: string, cfi: string): void => {
	if (!validBookId(bookId) || !validCFI(cfi)) return
	const backups = readAll()
	delete backups[bookId]
	backups[bookId] = { cfi, updatedAt: Date.now() }
	writeAll(backups)
}

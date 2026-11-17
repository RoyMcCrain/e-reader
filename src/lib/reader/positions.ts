import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface SendingPosition {
	cfi: string
	mutationId: string
	baseRevision: number
}
export interface SavedPosition {
	bookId: string
	cfi: string
	revision: number
	mutationId: string
	baseRevision: number
	pending: boolean
	conflict?: RemotePosition | null
	sending?: SendingPosition
}
export interface RemotePosition {
	cfi: string
	revision: number
	mutationId: string
}
interface PositionDatabase extends DBSchema {
	positions: { key: string; value: SavedPosition }
}

let connection: Promise<IDBPDatabase<PositionDatabase>> | undefined
const validCFI = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 4096 &&
	/^epubcfi\(.+\)$/u.test(value)
const validId = (value: unknown): value is string =>
	typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
const validRevision = (value: unknown): value is number =>
	Number.isSafeInteger(value) && (value as number) >= 0
const validMutation = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
		value,
	)
const validRemote = (value: unknown): value is RemotePosition => {
	if (!value || typeof value !== 'object') return false
	const row = value as Record<string, unknown>
	return (
		validCFI(row.cfi) &&
		validRevision(row.revision) &&
		validMutation(row.mutationId)
	)
}
const database = () => {
	if (typeof indexedDB === 'undefined')
		return Promise.reject(new Error('IndexedDB unavailable'))
	connection ??= openDB<PositionDatabase>('reader-positions', 1, {
		upgrade(db) {
			if (!db.objectStoreNames.contains('positions'))
				db.createObjectStore('positions', { keyPath: 'bookId' })
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

export const hashBook = async (file: File): Promise<string> => {
	if (!globalThis.crypto?.subtle) throw new Error('crypto unavailable')
	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('')
}
const parseSending = (value: unknown): SendingPosition | undefined => {
	if (!value || typeof value !== 'object') return undefined
	const row = value as Record<string, unknown>
	if (
		!validCFI(row.cfi) ||
		!validMutation(row.mutationId) ||
		!validRevision(row.baseRevision)
	)
		return undefined
	return {
		cfi: row.cfi,
		mutationId: row.mutationId,
		baseRevision: row.baseRevision,
	}
}
const validSavedCore = (
	bookId: string,
	row: Record<string, unknown>,
): row is Record<string, unknown> & {
	cfi: string
	revision: number
	baseRevision: number
	mutationId: string
	pending: boolean
} =>
	row.bookId === bookId &&
	validCFI(row.cfi) &&
	validRevision(row.revision) &&
	validRevision(row.baseRevision) &&
	validMutation(row.mutationId) &&
	typeof row.pending === 'boolean'
const parseConflict = (value: unknown): RemotePosition | null | undefined => {
	if (value === undefined || value === null) return value
	return validRemote(value) ? value : undefined
}
const savedExtras = (row: Record<string, unknown>) => {
	const sending =
		row.sending === undefined ? undefined : parseSending(row.sending)
	const conflict = parseConflict(row.conflict)
	if (
		(row.sending !== undefined && !sending) ||
		(row.conflict !== undefined && conflict === undefined)
	)
		return undefined
	return {
		...(sending ? { sending } : {}),
		...(conflict !== undefined ? { conflict } : {}),
	}
}
const parseSaved = (
	bookId: string,
	value: unknown,
): SavedPosition | undefined => {
	if (!value || typeof value !== 'object') return undefined
	const row = value as Record<string, unknown>
	if (!validSavedCore(bookId, row)) return undefined
	const extras = savedExtras(row)
	if (!extras) return undefined
	return {
		bookId,
		cfi: row.cfi,
		revision: row.revision,
		baseRevision: row.baseRevision,
		mutationId: row.mutationId,
		pending: row.pending,
		...extras,
	}
}
export const loadPosition = async (
	bookId: string,
): Promise<SavedPosition | undefined> => {
	if (!validId(bookId)) return undefined
	const db = await database()
	return parseSaved(bookId, await db.get('positions', bookId))
}

const pendingBookId = (value: unknown): string | undefined => {
	if (!value || typeof value !== 'object' || !('bookId' in value))
		return undefined
	if (!validId(value.bookId)) return undefined
	const saved = parseSaved(value.bookId, value)
	return saved?.pending && saved.conflict === undefined
		? saved.bookId
		: undefined
}
export const flushPendingPositions = async (): Promise<void> => {
	const db = await database()
	const rows = await db.getAll('positions')
	for (const value of rows) {
		const bookId = pendingBookId(value)
		if (!bookId) continue
		const status = await syncPosition(bookId)
		if (status === 'auth') return
	}
}

const preservedFields = (existing?: SavedPosition) => ({
	...(existing?.conflict !== undefined ? { conflict: existing.conflict } : {}),
	...(existing?.sending ? { sending: existing.sending } : {}),
})
const updatedRecord = (
	bookId: string,
	cfi: string,
	existing?: SavedPosition,
): SavedPosition => ({
	bookId,
	cfi,
	revision: existing?.revision ?? 0,
	baseRevision: existing?.baseRevision ?? existing?.revision ?? 0,
	mutationId: crypto.randomUUID(),
	pending: true,
	...preservedFields(existing),
})
const saveInTransaction = async (bookId: string, cfi: string) => {
	const db = await database()
	const tx = db.transaction('positions', 'readwrite')
	const existing = parseSaved(bookId, await tx.store.get(bookId))
	if (existing?.cfi !== cfi) {
		await tx.store.put(updatedRecord(bookId, cfi, existing))
	}
	await tx.done
}
export const savePosition = async (
	bookId: string,
	cfi: string,
): Promise<void> => {
	if (!validId(bookId) || !validCFI(cfi)) throw new Error('Invalid position')
	await saveInTransaction(bookId, cfi)
}

const parsePositionBody = (body: unknown): RemotePosition | null => {
	if (!body || typeof body !== 'object' || !('position' in body))
		throw new Error('Invalid position response')
	const value = (body as { position: unknown }).position
	if (value !== null && !validRemote(value))
		throw new Error('Invalid remote position')
	return value
}
const requestOptions = () => ({
	credentials: 'same-origin' as RequestCredentials,
	cache: 'no-store' as RequestCache,
	headers: { 'X-Requested-With': 'XMLHttpRequest' },
	signal: AbortSignal.timeout(10000),
})
export const fetchRemotePosition = async (
	bookId: string,
): Promise<RemotePosition | null> => {
	if (!validId(bookId)) throw new Error('Invalid book id')
	const response = await fetch(
		`/api/reading-positions/${bookId}`,
		requestOptions(),
	)
	if (response.status === 401 || response.status === 403)
		throw new Error('auth')
	if (
		!response.ok ||
		response.redirected ||
		!response.headers.get('content-type')?.includes('application/json')
	)
		throw new Error(`HTTP ${response.status}`)
	return parsePositionBody(await response.json())
}

const parseResponsePosition = async (
	response: Response,
): Promise<RemotePosition | null | undefined> => {
	try {
		return parsePositionBody(await response.json())
	} catch {
		return undefined
	}
}
const hasSnapshot = (
	row: SavedPosition | undefined,
	snapshot: SendingPosition,
) =>
	row?.sending?.cfi === snapshot.cfi &&
	row.sending.mutationId === snapshot.mutationId &&
	row.sending.baseRevision === snapshot.baseRevision
const selectSnapshot = async (bookId: string) => {
	const db = await database()
	const tx = db.transaction('positions', 'readwrite')
	const row = parseSaved(bookId, await tx.store.get(bookId))
	if (!row?.pending || row.conflict !== undefined) {
		await tx.done
		return undefined
	}
	const sending = row.sending ?? {
		cfi: row.cfi,
		mutationId: row.mutationId,
		baseRevision: row.baseRevision,
	}
	if (!row.sending) await tx.store.put({ ...row, sending })
	await tx.done
	return sending
}
const updateAck = async (
	bookId: string,
	snapshot: SendingPosition,
	ack: RemotePosition,
): Promise<boolean> => {
	if (
		ack.cfi !== snapshot.cfi ||
		ack.mutationId !== snapshot.mutationId ||
		ack.revision !== snapshot.baseRevision + 1
	)
		return false
	const db = await database()
	const tx = db.transaction('positions', 'readwrite')
	const row = parseSaved(bookId, await tx.store.get(bookId))
	if (hasSnapshot(row, snapshot) && row) {
		if (row.mutationId === snapshot.mutationId) {
			await tx.store.put({
				...row,
				revision: ack.revision,
				baseRevision: ack.revision,
				pending: false,
				sending: undefined,
			})
		} else {
			await tx.store.put({
				...row,
				revision: ack.revision,
				baseRevision: ack.revision,
				pending: true,
				sending: undefined,
			})
		}
	}
	await tx.done
	return hasSnapshot(row, snapshot)
}
const updateConflict = async (
	bookId: string,
	snapshot: SendingPosition,
	conflict: RemotePosition | null,
) => {
	const db = await database()
	const tx = db.transaction('positions', 'readwrite')
	const row = parseSaved(bookId, await tx.store.get(bookId))
	if (hasSnapshot(row, snapshot) && row)
		await tx.store.put({ ...row, sending: undefined, conflict, pending: true })
	await tx.done
}
const validJsonResponse = (response: Response) =>
	!response.redirected &&
	response.headers.get('content-type')?.includes('application/json')
const handleConflict = async (
	bookId: string,
	snapshot: SendingPosition,
	response: Response,
): Promise<SyncStatus> => {
	if (!validJsonResponse(response)) return 'pending'
	const conflict = await parseResponsePosition(response)
	if (conflict === undefined) return 'pending'
	await updateConflict(bookId, snapshot, conflict)
	return 'conflict'
}
const handleAcknowledgement = async (
	bookId: string,
	snapshot: SendingPosition,
	response: Response,
): Promise<SyncStatus> => {
	if (!response.ok || !validJsonResponse(response)) return 'pending'
	const ack = await parseResponsePosition(response)
	if (!ack) return 'pending'
	return (await updateAck(bookId, snapshot, ack)) ? 'synced' : 'pending'
}
const transmit = async (
	bookId: string,
	snapshot: SendingPosition,
): Promise<SyncStatus> => {
	let response: Response
	try {
		response = await fetch(`/api/reading-positions/${bookId}`, {
			...requestOptions(),
			method: 'PUT',
			headers: {
				...requestOptions().headers,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(snapshot),
		})
	} catch {
		return 'pending'
	}
	if (response.status === 401 || response.status === 403) return 'auth'
	if (response.status === 409) return handleConflict(bookId, snapshot, response)
	return handleAcknowledgement(bookId, snapshot, response)
}
export type SyncStatus = 'synced' | 'pending' | 'auth' | 'conflict'
const queues = new Map<string, Promise<SyncStatus>>()
const flush = async (bookId: string): Promise<SyncStatus> => {
	let status: SyncStatus = 'synced'
	for (let count = 0; count < 4; count++) {
		const snapshot = await selectSnapshot(bookId)
		if (!snapshot) {
			const current = await loadPosition(bookId)
			return current?.conflict !== undefined ? 'conflict' : status
		}
		status = await transmit(bookId, snapshot)
		if (status !== 'synced') return status
	}
	return (await loadPosition(bookId))?.pending ? 'pending' : 'synced'
}
export const syncPosition = (bookId: string): Promise<SyncStatus> => {
	if (!validId(bookId)) return Promise.resolve('pending')
	const previous = queues.get(bookId) ?? Promise.resolve('synced' as SyncStatus)
	const task = previous
		.catch(() => 'pending' as SyncStatus)
		.then(() => flush(bookId))
	queues.set(bookId, task)
	const clearQueue = () => {
		if (queues.get(bookId) === task) queues.delete(bookId)
	}
	void task.then(clearQueue, clearQueue)
	return task
}

const mutationMatches = (
	current: SavedPosition | undefined,
	expectedMutationId: string | undefined,
) =>
	expectedMutationId === undefined
		? !current
		: current?.mutationId === expectedMutationId
const canAdoptRemote = (
	current: SavedPosition | undefined,
	remote: RemotePosition,
	expectedMutationId: string | undefined,
) => {
	const isClean =
		!current ||
		(!current.pending && !current.sending && current.conflict === undefined)
	const isNotOlder = !current || remote.revision >= current.revision
	return mutationMatches(current, expectedMutationId) && isClean && isNotOlder
}
export const adoptRemotePosition = async (
	bookId: string,
	remote: RemotePosition,
	expectedMutationId?: string,
): Promise<boolean> => {
	if (!validId(bookId) || !validRemote(remote)) return false
	const db = await database()
	const tx = db.transaction('positions', 'readwrite')
	const current = parseSaved(bookId, await tx.store.get(bookId))
	if (!canAdoptRemote(current, remote, expectedMutationId)) {
		await tx.done
		return false
	}
	await tx.store.put({
		bookId,
		cfi: remote.cfi,
		revision: remote.revision,
		baseRevision: remote.revision,
		mutationId: remote.mutationId,
		pending: false,
	})
	await tx.done
	return true
}
export const chooseLocalPosition = async (bookId: string): Promise<void> => {
	if (!validId(bookId)) return
	const db = await database()
	const tx = db.transaction('positions', 'readwrite')
	const row = parseSaved(bookId, await tx.store.get(bookId))
	if (row?.conflict !== undefined) {
		const baseRevision = row.conflict?.revision ?? 0
		await tx.store.put({
			...row,
			baseRevision,
			mutationId: crypto.randomUUID(),
			pending: true,
			conflict: undefined,
			sending: undefined,
		})
	}
	await tx.done
}
const validRemoteChoice = (bookId: string, remote?: RemotePosition) =>
	validId(bookId) && (remote === undefined || validRemote(remote))
const expectedRemoteMutationMatches = (
	row: SavedPosition | undefined,
	expectedMutationId: string | undefined,
) => expectedMutationId === undefined || row?.mutationId === expectedMutationId
const canChooseRemotePosition = (
	row: SavedPosition | undefined,
	selected: RemotePosition,
) => !row?.sending && (!row || selected.revision >= row.revision)

export const chooseRemotePosition = async (
	bookId: string,
	remote?: RemotePosition,
	expectedMutationId?: string,
): Promise<string | undefined> => {
	if (!validRemoteChoice(bookId, remote)) return undefined
	const db = await database()
	const tx = db.transaction('positions', 'readwrite')
	const row = parseSaved(bookId, await tx.store.get(bookId))
	if (!expectedRemoteMutationMatches(row, expectedMutationId)) {
		await tx.done
		return undefined
	}
	const selected = remote ?? row?.conflict ?? undefined
	if (!selected || !canChooseRemotePosition(row, selected)) {
		await tx.done
		return undefined
	}
	await tx.store.put({
		bookId,
		cfi: selected.cfi,
		revision: selected.revision,
		baseRevision: selected.revision,
		mutationId: selected.mutationId,
		pending: false,
	})
	await tx.done
	return selected.cfi
}

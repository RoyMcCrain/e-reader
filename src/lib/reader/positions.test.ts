import 'fake-indexeddb/auto'
import { ok, rejects } from 'node:assert/strict'

import { openDB } from 'idb'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
	adoptRemotePosition,
	loadPosition,
	savePosition,
	syncPosition,
	chooseLocalPosition,
	chooseRemotePosition,
	flushPendingPositions,
} from './positions'

let bookId = 'a'.repeat(64)
let sequence = 0
const first = 'epubcfi(/6/2[chapter]!/4/2)'
const second = 'epubcfi(/6/4[chapter]!/4/2)'
const remote = {
	cfi: second,
	revision: 7,
	mutationId: '123e4567-e89b-42d3-a456-426614174000',
}
const originalFetch = globalThis.fetch

const parseMutation = (init?: RequestInit) => {
	ok(typeof init?.body === 'string', 'Expected string request body')
	const body: unknown = JSON.parse(init.body)
	ok(body !== null && typeof body === 'object', 'Invalid request mutation')
	ok(
		'cfi' in body &&
			typeof body.cfi === 'string' &&
			'mutationId' in body &&
			typeof body.mutationId === 'string' &&
			'baseRevision' in body &&
			typeof body.baseRevision === 'number',
		'Invalid request mutation',
	)
	return {
		cfi: body.cfi,
		mutationId: body.mutationId,
		baseRevision: body.baseRevision,
	}
}

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})

beforeEach(async () => {
	sequence += 1
	bookId = sequence.toString(16).padStart(64, '0')
	await loadPosition(bookId)
	const db = await openDB('reader-positions')
	await db.clear('positions')
	db.close()
})

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe('position persistence and synchronization', () => {
	test('rejects invalid saves without overwriting the last valid record', async () => {
		await savePosition(bookId, first)
		const invalidSave = savePosition(bookId, `epubcfi(${'x'.repeat(4090)})`)
		await rejects(invalidSave, /Invalid position/u)
		expect((await loadPosition(bookId))?.cfi).toBe(first)
	})

	test('acknowledges an in-flight snapshot then drains the latest save at the acknowledged revision', async () => {
		let release: (() => void) | undefined
		let started: (() => void) | undefined
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve
		})
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		const requests: ReturnType<typeof parseMutation>[] = []
		globalThis.fetch = async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const body = parseMutation(init)
			requests.push(body)
			if (requests.length === 1) {
				started?.()
				await gate
			}
			return jsonResponse(200, {
				position: {
					cfi: body.cfi,
					mutationId: body.mutationId,
					revision: body.baseRevision + 1,
				},
			})
		}
		await savePosition(bookId, first)
		const syncing = syncPosition(bookId)
		await requestStarted
		await savePosition(bookId, second)
		release?.()
		expect(await syncing).toBe('synced')
		expect(
			requests.map(({ cfi, baseRevision }) => ({ cfi, baseRevision })),
		).toEqual([
			{ cfi: first, baseRevision: 0 },
			{ cfi: second, baseRevision: 1 },
		])
		expect((await loadPosition(bookId))?.cfi).toBe(second)
	})
	test('preserves a sending snapshot across a network failure and drains newer edits', async () => {
		const requests: ReturnType<typeof parseMutation>[] = []
		let fail = true
		globalThis.fetch = async (_input, init) => {
			const body = parseMutation(init)
			requests.push(body)
			if (fail) throw new Error('offline')
			return jsonResponse(200, {
				position: {
					cfi: body.cfi,
					mutationId: body.mutationId,
					revision: body.baseRevision + 1,
				},
			})
		}

		await savePosition(bookId, first)
		expect(await syncPosition(bookId)).toBe('pending')
		const retained = await loadPosition(bookId)
		expect(retained?.sending?.cfi).toBe(first)
		await savePosition(bookId, second)
		fail = false
		expect(await syncPosition(bookId)).toBe('synced')
		expect(requests).toHaveLength(3)
		expect(requests[1]).toEqual(requests[0])
		expect(requests[2].cfi).toBe(second)
		expect(requests[2].baseRevision).toBe(1)
	})

	test('rejects a remote choice while sending and after a newer acknowledgement', async () => {
		const cleanRemote = { ...remote, revision: 7 }
		expect(await adoptRemotePosition(bookId, cleanRemote)).toBe(true)
		await savePosition(bookId, first)
		const localMutationId = (await loadPosition(bookId))?.mutationId
		ok(localMutationId)

		let release: (() => void) | undefined
		let started: (() => void) | undefined
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve
		})
		const gate = new Promise<void>((resolve) => {
			release = resolve
		})
		globalThis.fetch = async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			const mutation = parseMutation(init)
			started?.()
			await gate
			return jsonResponse(200, {
				position: {
					cfi: mutation.cfi,
					mutationId: mutation.mutationId,
					revision: 8,
				},
			})
		}

		const syncing = syncPosition(bookId)
		await requestStarted
		try {
			expect(
				await chooseRemotePosition(bookId, cleanRemote, localMutationId),
			).toBeUndefined()
			expect((await loadPosition(bookId))?.pending).toBe(true)
		} finally {
			release?.()
		}

		expect(await syncing).toBe('synced')
		expect(
			await chooseRemotePosition(bookId, cleanRemote, localMutationId),
		).toBeUndefined()
		expect((await loadPosition(bookId))?.revision).toBe(8)
	})

	test('keeps conflicts pending and rebases the explicit local choice on remote revision', async () => {
		globalThis.fetch = async () => jsonResponse(409, { position: remote })
		await savePosition(bookId, first)
		expect(await syncPosition(bookId)).toBe('conflict')
		expect((await loadPosition(bookId))?.pending).toBe(true)
		expect(await syncPosition(bookId)).toBe('conflict')
		await chooseLocalPosition(bookId)
		const rebased = await loadPosition(bookId)
		expect(rebased?.baseRevision).toBe(remote.revision)
		expect(rebased?.cfi).toBe(first)
		globalThis.fetch = async (_input, init) => {
			const body = parseMutation(init)
			expect(body.baseRevision).toBe(7)
			return jsonResponse(200, {
				position: { cfi: body.cfi, mutationId: body.mutationId, revision: 8 },
			})
		}
		expect(await syncPosition(bookId)).toBe('synced')
	})

	test('null conflicts remain conflicts across retries and local resolution rebases to zero', async () => {
		globalThis.fetch = async () => jsonResponse(409, { position: null })
		await savePosition(bookId, first)
		expect(await syncPosition(bookId)).toBe('conflict')
		expect(await syncPosition(bookId)).toBe('conflict')
		await chooseLocalPosition(bookId)
		expect((await loadPosition(bookId))?.baseRevision).toBe(0)
		globalThis.fetch = async (_input, init) => {
			const body = parseMutation(init)
			expect(body.baseRevision).toBe(0)
			return jsonResponse(200, {
				position: { cfi: body.cfi, mutationId: body.mutationId, revision: 1 },
			})
		}
		expect(await syncPosition(bookId)).toBe('synced')
		expect((await loadPosition(bookId))?.pending).toBe(false)
	})

	test('conditional adoption rejects late results and explicit remote choice adopts conflict', async () => {
		expect(await adoptRemotePosition(bookId, remote, undefined)).toBe(true)
		expect(await adoptRemotePosition(bookId, remote, undefined)).toBe(false)
		await savePosition(bookId, first)
		expect(await adoptRemotePosition(bookId, remote)).toBe(false)
		const mutationId = (await loadPosition(bookId))?.mutationId
		expect(
			await chooseRemotePosition(
				bookId,
				remote,
				'00000000-0000-4000-8000-000000000000',
			),
		).toBeUndefined()
		expect((await loadPosition(bookId))?.pending).toBe(true)
		expect(await chooseRemotePosition(bookId, remote, mutationId)).toBe(second)
		expect((await loadPosition(bookId))?.pending).toBe(false)
	})

	test('rejects a response that does not exactly acknowledge the sending snapshot', async () => {
		globalThis.fetch = async () => jsonResponse(200, { position: remote })
		await savePosition(bookId, first)
		expect(await syncPosition(bookId)).toBe('pending')
		const row = await loadPosition(bookId)
		expect(row?.pending).toBe(true)
		expect(row?.sending?.cfi).toBe(first)
	})

	test('home retry continues past a failed book and skips unresolved conflicts', async () => {
		const conflictBookId = 'c'.repeat(64)
		const failingBookId = 'd'.repeat(64)
		const healthyBookId = 'e'.repeat(64)
		await savePosition(conflictBookId, first)
		globalThis.fetch = async () => jsonResponse(409, { position: remote })
		expect(await syncPosition(conflictBookId)).toBe('conflict')

		await savePosition(failingBookId, first)
		await savePosition(healthyBookId, second)
		const attemptedBooks: string[] = []
		globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
			const requestUrl = input instanceof Request ? input.url : String(input)
			const book = requestUrl.split('/').at(-1)
			if (book) attemptedBooks.push(book)
			const body = parseMutation(init)
			if (book === failingBookId) return jsonResponse(413, {})
			return jsonResponse(200, {
				position: {
					cfi: body.cfi,
					mutationId: body.mutationId,
					revision: body.baseRevision + 1,
				},
			})
		}

		await flushPendingPositions()
		expect(attemptedBooks).not.toContain(conflictBookId)
		expect(attemptedBooks).toContain(failingBookId)
		expect(attemptedBooks).toContain(healthyBookId)
		expect((await loadPosition(failingBookId))?.pending).toBe(true)
		expect((await loadPosition(healthyBookId))?.pending).toBe(false)
	})

	test('auth failures report auth without clearing pending work', async () => {
		for (const status of [401, 403]) {
			globalThis.fetch = async () => jsonResponse(status, {})
			await savePosition(bookId, first)
			expect(await syncPosition(bookId)).toBe('auth')
			expect((await loadPosition(bookId))?.pending).toBe(true)
		}
	})
})

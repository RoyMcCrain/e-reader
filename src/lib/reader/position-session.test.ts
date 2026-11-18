import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'vitest'

import {
	refreshPositionSession,
	rollbackPositionSession,
} from './position-session'
import {
	adoptRemotePosition,
	loadPosition,
	savePosition,
	syncPosition,
} from './positions'

const newBookId = () => crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')
const localId = newBookId()
const unrelatedId = newBookId()
const concurrentId = newBookId()
const localCfi = 'epubcfi(/6/2[local]!/4/2)'
const remoteCfi = 'epubcfi(/6/4[remote]!/4/2)'
const latestCfi = 'epubcfi(/6/6[latest]!/4/2)'
const userCfi = 'epubcfi(/6/8[user]!/4/2)'
const remote = {
	cfi: remoteCfi,
	revision: 2,
	mutationId: '123e4567-e89b-42d3-a456-426614174000',
}
const originalFetch = globalThis.fetch
let epoch = 0
let displayed = localCfi
const makeEpub = (duringRestore?: () => Promise<void>) => ({
	checkpoint: () => ({ cfi: displayed, epoch }),
	untouched: () => epoch === 0,
	restore: async (
		cfi: string,
		onlyIfUntouched = false,
		expectedEpoch?: number,
	) => {
		if (
			(onlyIfUntouched && epoch !== 0) ||
			(expectedEpoch !== undefined && expectedEpoch !== epoch)
		)
			return false
		displayed = cfi
		if (cfi === remoteCfi) await duringRestore?.()
		return true
	},
})

afterEach(() => {
	globalThis.fetch = originalFetch
	epoch = 0
	displayed = localCfi
})

describe('reader position refresh', () => {
	test('a failed clean-book fetch can retry without flushing another book', async () => {
		await savePosition(unrelatedId, localCfi)
		let gets = 0
		let posts = 0
		globalThis.fetch = async (_input, init) => {
			if (init?.method === 'PUT') {
				posts += 1
				return new Response('{}', { status: 500 })
			}
			gets += 1
			if (gets === 1) throw new Error('offline')
			return new Response(JSON.stringify({ position: remote }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		}
		const epub = makeEpub()
		const options = { bookId: localId, epub, isCurrent: () => true }

		await refreshPositionSession(options)
		const result = await refreshPositionSession(options)

		expect(result.status).toBe('別端末の位置に移動しました。')
		expect(displayed).toBe(remoteCfi)
		expect((await loadPosition(localId))?.cfi).toBe(remoteCfi)
		expect((await loadPosition(unrelatedId))?.pending).toBe(true)
		expect(posts).toBe(0)
	})

	test('a concurrent save rejects adoption and rolls the renderer back to newest local state', async () => {
		await savePosition(concurrentId, localCfi)
		globalThis.fetch = async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			if (init?.method === 'PUT') {
				const body: unknown =
					typeof init.body === 'string' ? JSON.parse(init.body) : undefined
				if (
					body &&
					typeof body === 'object' &&
					'cfi' in body &&
					'mutationId' in body &&
					'baseRevision' in body
				)
					return new Response(
						JSON.stringify({
							position: {
								cfi: body.cfi,
								mutationId: body.mutationId,
								revision: Number(body.baseRevision) + 1,
							},
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } },
					)
			}
			return new Response(JSON.stringify({ position: remote }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		}
		await syncPosition(concurrentId)
		globalThis.fetch = async () =>
			new Response(JSON.stringify({ position: remote }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		const epub = makeEpub(async () => savePosition(concurrentId, latestCfi))

		const result = await refreshPositionSession({
			bookId: concurrentId,
			epub,
			isCurrent: () => true,
		})

		expect(result.status).toBe('端末の新しい位置を保持しました。')
		expect((await loadPosition(concurrentId))?.cfi).toBe(latestCfi)
		expect((await loadPosition(concurrentId))?.pending).toBe(true)
		expect(displayed).toBe(latestCfi)
	})

	test('a touched reader does not jump remotely and stale rollback cannot undo newer navigation', async () => {
		const touchedBookId = newBookId()
		await adoptRemotePosition(touchedBookId, {
			cfi: localCfi,
			revision: 1,
			mutationId: remote.mutationId,
		})
		globalThis.fetch = async () =>
			new Response(JSON.stringify({ position: remote }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
		epoch = 1
		displayed = userCfi
		const epub = makeEpub()

		const result = await refreshPositionSession({
			bookId: touchedBookId,
			epub,
			isCurrent: () => true,
		})
		await rollbackPositionSession(
			{ bookId: touchedBookId, epub, isCurrent: () => true },
			{ cfi: localCfi, epoch: 0 },
		)

		expect(result.remote?.cfi).toBe(remoteCfi)
		expect(displayed).toBe(userCfi)
	})
})

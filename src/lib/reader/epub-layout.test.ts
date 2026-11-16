import { describe, expect, test } from 'bun:test'

import { awaitOwned, awaitWithAbort } from '#lib/reader/epub-layout'

const deferred = <T>() => {
	let resolve!: (value: T) => void
	let reject!: (reason: Error) => void
	const promise = new Promise<T>((fulfill, fail) => {
		resolve = fulfill
		reject = fail
	})
	return { promise, resolve, reject }
}

describe('awaitWithAbort', () => {
	test('propagates resolution and rejection', async () => {
		const controller = new AbortController()
		expect(
			await awaitWithAbort(Promise.resolve('ready'), controller.signal),
		).toBe('ready')
		const failure = new Error('failed')
		expect(
			awaitWithAbort(Promise.reject(failure), controller.signal),
		).rejects.toBe(failure)
	})

	test('abort前に拒否されたpromiseを観測しAbortErrorを返す', async () => {
		const controller = new AbortController()
		controller.abort()
		const rejection = Promise.reject(new Error('late rejection'))

		expect(awaitWithAbort(rejection, controller.signal)).rejects.toMatchObject({
			name: 'AbortError',
		})
		await new Promise<void>((resolve) => setImmediate(resolve))
	})

	test('rejects when aborted while the promise is pending', async () => {
		const controller = new AbortController()
		const pending = deferred<string>()
		const wrapped = awaitWithAbort(pending.promise, controller.signal)
		controller.abort()
		expect(await Promise.allSettled([wrapped])).toMatchObject([
			{ status: 'rejected', reason: { name: 'AbortError' } },
		])
		pending.resolve('late value')
	})
})

describe('awaitOwned', () => {
	test('cleans up a resource that resolves after cancellation exactly once', async () => {
		const controller = new AbortController()
		const pending = deferred<string>()
		const cleaned: string[] = []
		let completeCleanup!: () => void
		const cleanupCompleted = new Promise<void>((resolve) => {
			completeCleanup = resolve
		})
		const wrapped = awaitOwned(pending.promise, controller.signal, (value) => {
			cleaned.push(value)
			completeCleanup()
		})
		controller.abort()
		expect(await Promise.allSettled([wrapped])).toMatchObject([
			{ status: 'rejected', reason: { name: 'AbortError' } },
		])
		expect(cleaned).toEqual([])
		pending.resolve('resource')
		await cleanupCompleted
		await new Promise<void>((resolve) => setImmediate(resolve))
		expect(cleaned).toEqual(['resource'])
	})

	test('returns successful resources without premature cleanup', async () => {
		const controller = new AbortController()
		const cleaned: string[] = []
		const result = await awaitOwned(
			Promise.resolve('resource'),
			controller.signal,
			(value) => cleaned.push(value),
		)
		controller.abort()
		expect(result).toBe('resource')
		expect(cleaned).toEqual([])
	})

	test('observes late rejection after cancellation without cleanup', async () => {
		const controller = new AbortController()
		const pending = deferred<string>()
		const cleaned: string[] = []
		const wrapped = awaitOwned(pending.promise, controller.signal, (value) =>
			cleaned.push(value),
		)
		controller.abort()
		expect(await Promise.allSettled([wrapped])).toMatchObject([
			{ status: 'rejected', reason: { name: 'AbortError' } },
		])
		pending.reject(new Error('late failure'))
		await new Promise<void>((resolve) => setImmediate(resolve))
		expect(cleaned).toEqual([])
	})

	test('propagates ordinary rejection without cleaning up', async () => {
		const failure = new Error('resource failed')
		const cleaned: string[] = []
		expect(
			awaitOwned(
				Promise.reject(failure),
				new AbortController().signal,
				(value) => cleaned.push(value),
			),
		).rejects.toBe(failure)
		expect(cleaned).toEqual([])
	})
})

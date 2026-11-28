import { rejects, strictEqual } from 'node:assert/strict'

import { afterEach, describe, expect, test } from 'vite-plus/test'

import { downloadBookFile } from './book-file'

const book = { id: 'a'.repeat(64), name: '巻1.epub', format: 'epub' as const }
const originalFetch = globalThis.fetch

afterEach(() => {
	globalThis.fetch = originalFetch
})

describe('downloadBookFile', () => {
	test('returns a named file with the format mime type', async () => {
		globalThis.fetch = async () =>
			new Response('book-bytes', {
				headers: { 'content-type': 'application/epub+zip' },
			})

		const file = await downloadBookFile(book, new AbortController().signal)

		expect(file.name).toBe('巻1.epub')
		expect(file.type).toBe('application/epub+zip')
		expect(await file.text()).toBe('book-bytes')
	})

	test('rejects when the content type does not match the format', async () => {
		globalThis.fetch = async () =>
			new Response('not a book', {
				headers: { 'content-type': 'text/html' },
			})

		await rejects(
			downloadBookFile(book, new AbortController().signal),
			/download/u,
		)
	})

	test('rejects when the response is not ok', async () => {
		globalThis.fetch = async () =>
			new Response('missing', {
				status: 404,
				headers: { 'content-type': 'application/epub+zip' },
			})

		await rejects(
			downloadBookFile(book, new AbortController().signal),
			/download/u,
		)
	})

	test('passes the abort signal through to fetch', async () => {
		const controller = new AbortController()
		let received: AbortSignal | null | undefined
		globalThis.fetch = async (
			_input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			received = init?.signal
			controller.abort()
			throw new DOMException('aborted', 'AbortError')
		}

		await rejects(downloadBookFile(book, controller.signal), /aborted/u)
		strictEqual(received, controller.signal)
	})
})

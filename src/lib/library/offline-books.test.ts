import 'fake-indexeddb/auto'
import { ok } from 'node:assert/strict'

import { openDB } from 'idb'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
	listOfflineSaves,
	loadOfflineFile,
	removeOfflineBook,
	saveOfflineBook,
} from './offline-books'

const bookId = (digit: string) => digit.repeat(64)
const epubBook = {
	id: bookId('a'),
	name: '巻1.epub',
	format: 'epub',
	size: 3,
} as const
const zipBook = {
	id: bookId('b'),
	name: '別作品.zip',
	format: 'zip',
	size: 3,
} as const
const bytes = (values: number[]) => new Blob([new Uint8Array(values)])

afterEach(async () => {
	const raw = await openDB('reader-offline-books', 1)
	await raw.clear('books')
	raw.close()
})

describe('offline books', () => {
	test('saves books and lists them newest first', async () => {
		// Arrange
		await saveOfflineBook(epubBook, bytes([1, 2, 3]))
		await new Promise((resolve) => setTimeout(resolve, 5))

		// Act
		await saveOfflineBook(zipBook, bytes([4, 5, 6]))
		const saves = await listOfflineSaves()

		// Assert
		expect(saves.map((save) => save.bookId)).toEqual([zipBook.id, epubBook.id])
		expect(saves[0]).toMatchObject({
			name: zipBook.name,
			format: 'zip',
			size: 3,
		})
	})

	test('loads a saved book as a File with the format MIME type', async () => {
		// Arrange
		await saveOfflineBook(epubBook, bytes([1, 2, 3]))

		// Act
		const file = await loadOfflineFile(epubBook.id)

		// Assert
		ok(file, 'Expected a saved file')
		expect(file.name).toBe(epubBook.name)
		expect(file.type).toBe('application/epub+zip')
		expect(new Uint8Array(await file.arrayBuffer())).toEqual(
			new Uint8Array([1, 2, 3]),
		)
	})

	test('returns undefined for a book that was never saved', async () => {
		// Act
		const file = await loadOfflineFile(bookId('f'))

		// Assert
		expect(file).toBeUndefined()
	})

	test('removes a saved book', async () => {
		// Arrange
		await saveOfflineBook(zipBook, bytes([4]))

		// Act
		await removeOfflineBook(zipBook.id)

		// Assert
		expect(await listOfflineSaves()).toEqual([])
		expect(await loadOfflineFile(zipBook.id)).toBeUndefined()
	})

	test('skips malformed rows instead of failing the list', async () => {
		// Arrange
		await saveOfflineBook(epubBook, bytes([1]))
		const raw = await openDB('reader-offline-books', 1)
		await raw.put('books', {
			bookId: bookId('c'),
			name: '',
			format: 'epub',
			size: 1,
			blob: bytes([2]),
			savedAt: 1,
		})
		await raw.put('books', {
			bookId: bookId('d'),
			name: 'bad.pdf',
			format: 'pdf',
			size: 1,
			blob: bytes([3]),
			savedAt: 1,
		})
		raw.close()

		// Act
		const saves = await listOfflineSaves()

		// Assert
		expect(saves.map((save) => save.bookId)).toEqual([epubBook.id])
	})
})

import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
	loadZipLead,
	saveZipLead,
	ZIP_POSITIONS_KEY,
} from '#lib/reader/zip-position'

const storageDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	'localStorage',
)

afterEach(() => {
	if (storageDescriptor)
		Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
	else Reflect.deleteProperty(globalThis, 'localStorage')
})

const memoryStorage = () => {
	const values = new Map<string, string>()
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => void values.set(key, value),
			removeItem: (key: string) => void values.delete(key),
		},
	})
	return values
}

const bookId = 'b'.repeat(64)

describe('zip reading position', () => {
	test('round-trips a saved lead', () => {
		// Arrange
		memoryStorage()
		// Act
		saveZipLead(bookId, 7)
		// Assert
		expect(loadZipLead(bookId, 20)).toBe(7)
	})

	test('ignores invalid book ids and leads', () => {
		// Arrange
		const values = memoryStorage()
		// Act
		saveZipLead('short', 3)
		saveZipLead(bookId, -1)
		saveZipLead(bookId, 1.5)
		// Assert
		expect(values.has(ZIP_POSITIONS_KEY)).toBe(false)
	})

	test('clamps a saved lead that exceeds the current page count', () => {
		// Arrange
		memoryStorage()
		saveZipLead(bookId, 50)
		// Act & Assert
		expect(loadZipLead(bookId, 10)).toBe(9)
	})

	test('returns undefined for corrupt storage or invalid load arguments', () => {
		// Arrange
		const values = memoryStorage()
		values.set(ZIP_POSITIONS_KEY, '{broken')
		// Act & Assert
		expect(loadZipLead(bookId, 10)).toBeUndefined()
		expect(loadZipLead('nope', 10)).toBeUndefined()
		expect(loadZipLead(bookId, 0)).toBeUndefined()
	})

	test.each([
		['a null entry', JSON.stringify({ ['a'.repeat(64)]: null })],
		['an array root', '[]'],
		[
			'a non-numeric updatedAt',
			JSON.stringify({ ['a'.repeat(64)]: { lead: 3, updatedAt: 'later' } }),
		],
	])('ignores %s without blocking later saves', (_, stored) => {
		// Arrange
		const values = memoryStorage()
		values.set(ZIP_POSITIONS_KEY, stored)
		// Act
		saveZipLead(bookId, 4)
		// Assert
		expect(loadZipLead(bookId, 10)).toBe(4)
		expect(loadZipLead('a'.repeat(64), 10)).toBeUndefined()
	})

	test('keeps at most 200 books and drops the least recently updated', () => {
		// Arrange
		memoryStorage()
		const ids = Array.from({ length: 201 }, (_, index) =>
			index.toString(16).padStart(64, '0'),
		)
		// Act
		for (const id of ids) saveZipLead(id, 1)
		// Assert
		expect(loadZipLead(ids[0], 10)).toBeUndefined()
		expect(loadZipLead(ids[200], 10)).toBe(1)
	})
})

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import {
	clearLastSession,
	LAST_SESSION_KEY,
	readLastSession,
	writeLastSession,
} from '#lib/reader/last-session'

const storageDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	'localStorage',
)

afterEach(() => {
	vi.useRealTimers()
	if (storageDescriptor)
		Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
	else Reflect.deleteProperty(globalThis, 'localStorage')
})

const memoryStorage = () => {
	const values = new Map<string, string>()
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => void values.set(key, value),
		removeItem: (key: string) => void values.delete(key),
	}
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: storage,
	})
	return values
}

const bookId = 'a'.repeat(64)

describe('last reader session', () => {
	test('round-trips a written session with the write time', () => {
		// Arrange
		memoryStorage()
		vi.useFakeTimers()
		vi.setSystemTime(1_700_000_000_000)
		// Act
		writeLastSession({ bookId, name: 'book.epub', format: 'epub' })
		// Assert
		expect(readLastSession()).toEqual({
			bookId,
			name: 'book.epub',
			format: 'epub',
			updatedAt: 1_700_000_000_000,
		})
	})

	test('ignores invalid writes without storing anything', () => {
		// Arrange
		const values = memoryStorage()
		// Act
		writeLastSession({ bookId: 'not-hex', name: 'book.epub', format: 'epub' })
		writeLastSession({ bookId, name: '', format: 'epub' })
		writeLastSession({ bookId, name: 'book.epub', format: 'pdf' as never })
		// Assert
		expect(values.has(LAST_SESSION_KEY)).toBe(false)
		expect(readLastSession()).toBeUndefined()
	})

	test('returns undefined for corrupt or malformed stored values', () => {
		// Arrange
		const values = memoryStorage()
		// Act & Assert
		values.set(LAST_SESSION_KEY, '{broken')
		expect(readLastSession()).toBeUndefined()
		values.set(
			LAST_SESSION_KEY,
			JSON.stringify({ bookId, name: 'x', format: 'pdf', updatedAt: 1 }),
		)
		expect(readLastSession()).toBeUndefined()
	})

	test('a finished book clears the stored session instead of storing it', () => {
		// Arrange
		const values = memoryStorage()
		writeLastSession({ bookId, name: 'book.zip', format: 'zip' })
		// Act
		writeLastSession({ bookId, name: 'book.zip', format: 'zip', atEnd: true })
		// Assert
		expect(values.has(LAST_SESSION_KEY)).toBe(false)
		expect(readLastSession()).toBeUndefined()
	})

	test('clears the stored session', () => {
		// Arrange
		memoryStorage()
		writeLastSession({ bookId, name: 'book.zip', format: 'zip' })
		// Act
		clearLastSession()
		// Assert
		expect(readLastSession()).toBeUndefined()
	})

	test('never throws when storage is unavailable', () => {
		// Arrange
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get: () => {
				throw new Error('SecurityError')
			},
		})
		// Act & Assert
		expect(readLastSession()).toBeUndefined()
		expect(() =>
			writeLastSession({ bookId, name: 'book.zip', format: 'zip' }),
		).not.toThrow()
		expect(() => clearLastSession()).not.toThrow()
	})
})

import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
	EPUB_CFI_BACKUP_KEY,
	loadEpubCfiBackup,
	saveEpubCfiBackup,
	selectInitialCfi,
} from '#lib/reader/epub-cfi-backup'

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

const bookId = 'c'.repeat(64)

describe('epub CFI backup', () => {
	test('round-trips a saved CFI for the book', () => {
		// Arrange
		memoryStorage()
		// Act
		saveEpubCfiBackup(bookId, 'epubcfi(/6/4!/4/2)')
		// Assert
		expect(loadEpubCfiBackup(bookId)).toBe('epubcfi(/6/4!/4/2)')
		expect(loadEpubCfiBackup('d'.repeat(64))).toBeUndefined()
	})

	test('ignores CFIs that fail the positions.ts validation', () => {
		// Arrange
		const values = memoryStorage()
		// Act
		saveEpubCfiBackup(bookId, 'not-a-cfi')
		saveEpubCfiBackup(bookId, `epubcfi(${'x'.repeat(4096)})`)
		// Assert
		expect(values.has(EPUB_CFI_BACKUP_KEY)).toBe(false)
	})

	test('returns undefined for corrupt storage without throwing', () => {
		// Arrange
		const values = memoryStorage()
		values.set(EPUB_CFI_BACKUP_KEY, '[]')
		// Act & Assert
		expect(loadEpubCfiBackup(bookId)).toBeUndefined()
	})

	test.each([
		['a null entry', JSON.stringify({ ['e'.repeat(64)]: null })],
		['an array root', '[]'],
		[
			'a non-numeric updatedAt',
			JSON.stringify({
				['e'.repeat(64)]: { cfi: 'epubcfi(/6/2)', updatedAt: 'later' },
			}),
		],
	])('ignores %s without blocking later saves', (_, stored) => {
		// Arrange
		const values = memoryStorage()
		values.set(EPUB_CFI_BACKUP_KEY, stored)
		// Act
		saveEpubCfiBackup(bookId, 'epubcfi(/6/4)')
		// Assert
		expect(loadEpubCfiBackup(bookId)).toBe('epubcfi(/6/4)')
		expect(loadEpubCfiBackup('e'.repeat(64))).toBeUndefined()
	})

	test('keeps at most 200 books and drops the oldest backup', () => {
		// Arrange
		memoryStorage()
		const ids = Array.from({ length: 201 }, (_, index) =>
			index.toString(16).padStart(64, '0'),
		)
		// Act
		for (const id of ids) saveEpubCfiBackup(id, 'epubcfi(/6/2)')
		// Assert
		expect(loadEpubCfiBackup(ids[0])).toBeUndefined()
		expect(loadEpubCfiBackup(ids[200])).toBe('epubcfi(/6/2)')
	})
})

describe('initial CFI selection', () => {
	test.each([
		[undefined, undefined, undefined],
		['epubcfi(/6/2)', undefined, 'epubcfi(/6/2)'],
		[undefined, 'epubcfi(/6/4)', 'epubcfi(/6/4)'],
		['epubcfi(/6/2)', 'epubcfi(/6/4)', 'epubcfi(/6/4)'],
		['epubcfi(/6/4)', 'epubcfi(/6/4)', 'epubcfi(/6/4)'],
	])(
		'selects the backup over IndexedDB for (%s, %s)',
		(saved, backup, expected) => {
			// Arrange
			// Act
			const selected = selectInitialCfi(saved, backup)
			// Assert
			expect(selected).toBe(expected)
		},
	)
})

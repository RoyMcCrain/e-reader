import { describe, expect, test } from 'vite-plus/test'

import {
	filterBooks,
	groupBooks,
	selectRecentBooks,
	sortBooks,
} from './bookshelf'
import type { CloudBook } from './types'

const books: CloudBook[] = [
	{
		id: 'a',
		name: '星の旅 10.epub',
		format: 'epub',
		size: 1,
		series: '星の旅',
		uploadedAt: '2025-01-01T00:00:00Z',
	},
	{
		id: 'b',
		name: '星の旅 2.epub',
		format: 'epub',
		size: 1,
		series: '星の旅',
		uploadedAt: '2025-02-01T00:00:00Z',
	},
	{ id: 'c', name: 'ＡＢＣ.zip', format: 'zip', size: 1, series: '海の話' },
	{
		id: 'd',
		name: 'シリーズ未設定.epub',
		format: 'epub',
		size: 1,
		series: 'シリーズ未設定',
	},
	{ id: 'e', name: '独立.epub', format: 'epub', size: 1 },
]

describe('bookshelf helpers', () => {
	test('filters with normalized AND search terms across title and series combined with format', () => {
		expect(filterBooks(books, { query: '  星   ２ ', format: 'epub' })).toEqual(
			[books[1]],
		)
		expect(filterBooks(books, { query: '  ＡＢＣ ', format: 'zip' })).toEqual([
			books[2],
		])
		expect(filterBooks(books, { query: '   ', format: 'all' })).toEqual(books)
	})

	test('sorts series naturally and newest dates first with missing dates last without mutation', () => {
		const input = [...books]
		expect(sortBooks(input, 'series').map(({ id }) => id)).toEqual([
			'd',
			'c',
			'b',
			'a',
			'e',
		])
		expect(sortBooks(input, 'newest').map(({ id }) => id)).toEqual([
			'b',
			'a',
			'c',
			'd',
			'e',
		])
		expect(sortBooks(input, 'title').map(({ id }) => id)).toEqual([
			'c',
			'd',
			'b',
			'a',
			'e',
		])
		expect(input).toEqual(books)
	})

	test('breaks equal and missing-date newest ties by title and id', () => {
		const tiedBooks: CloudBook[] = [
			{
				id: 'z',
				name: '同じ題名.epub',
				format: 'epub',
				size: 1,
				uploadedAt: '2025-03-01T00:00:00Z',
			},
			{
				id: 'a',
				name: '同じ題名.epub',
				format: 'epub',
				size: 1,
				uploadedAt: '2025-03-01T00:00:00Z',
			},
			{ id: 'missing-z', name: 'B title.epub', format: 'epub', size: 1 },
			{ id: 'missing-a', name: 'A title.epub', format: 'epub', size: 1 },
		]

		expect(sortBooks(tiedBooks, 'newest').map(({ id }) => id)).toEqual([
			'a',
			'z',
			'missing-a',
			'missing-z',
		])
	})

	test('selects synced recent books by timestamp, excludes zero or missing positions, and limits stable ties', () => {
		const tied = [
			...books.slice(0, 3),
			...Array.from({ length: 8 }, (_, index) => ({
				id: `tie-${index}`,
				name: `同時刻 ${index}.epub`,
				format: 'epub' as const,
				size: 1,
			})),
		]
		const recency = Object.fromEntries([
			...tied.map(({ id }) => [id, 20] as const),
			['b', 30],
			['d', 0],
		])
		expect(selectRecentBooks(tied, recency, 8).map(({ id }) => id)).toEqual([
			'b',
			'a',
			'c',
			'tie-0',
			'tie-1',
			'tie-2',
			'tie-3',
			'tie-4',
		])
		expect(selectRecentBooks(tied, { a: 0, b: -1 }, 8)).toEqual([])
	})

	test('groups unassigned books separately from a real series with the same display label', () => {
		const groups = groupBooks([books[4], books[3], books[1], books[0]])
		expect(
			groups.map(({ series, books: group }) => [
				series,
				group.map(({ id }) => id),
			]),
		).toEqual([
			['シリーズ未設定', ['d']],
			['星の旅', ['b', 'a']],
			[undefined, ['e']],
		])
	})
})

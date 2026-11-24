import { describe, expect, test } from 'vite-plus/test'

import {
	filterBooks,
	formatReadAt,
	groupBooks,
	selectHistoryEntries,
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

	test('combines series and standalone books by latest read time without a limit', () => {
		const recency = { b: 30, c: 20, e: 10 }
		const entries = selectHistoryEntries(books, recency)
		expect(entries.map((entry) => entry.kind)).toEqual([
			'series',
			'series',
			'book',
		])
		const [series, secondSeries, standalone] = entries
		if (
			series?.kind !== 'series' ||
			secondSeries?.kind !== 'series' ||
			standalone?.kind !== 'book'
		)
			throw new Error('unexpected history entry kinds')
		expect(series.series).toBe('星の旅')
		expect(series.books.map(({ id }) => id)).toEqual(['b', 'a'])
		expect(series.representative.id).toBe('b')
		expect(series.readAt).toBe(30)
		expect(secondSeries.series).toBe('海の話')
		expect(secondSeries.books.map(({ id }) => id)).toEqual(['c'])
		expect(secondSeries.representative.id).toBe('c')
		expect(secondSeries.readAt).toBe(20)
		expect(standalone.book.id).toBe('e')
		expect(standalone.readAt).toBe(10)
	})

	test('excludes unread series while keeping every read entry beyond eight', () => {
		const many = Array.from({ length: 12 }, (_, index) => ({
			id: `solo-${index}`,
			name: `読み切り ${index}.epub`,
			format: 'epub' as const,
			size: 1,
		}))
		const recency = Object.fromEntries([
			...many.map(({ id }, index) => [id, index + 1] as const),
			['d', 0],
			['b', -1],
		])
		const entries = selectHistoryEntries([...books, ...many], recency)
		expect(entries).toHaveLength(12)
		expect(entries[0]).toMatchObject({ kind: 'book', readAt: 12 })
		expect(entries[entries.length - 1]).toMatchObject({
			kind: 'book',
			readAt: 1,
		})
		expect(
			entries.every(
				(entry) =>
					entry.kind !== 'series' ||
					(entry.series !== '星の旅' && entry.series !== 'シリーズ未設定'),
			),
		).toBe(true)
		expect(selectHistoryEntries(books, {})).toEqual([])
	})

	test('prefers the latest read volume within a series with stable ties', () => {
		const volumes: CloudBook[] = [
			{ id: 's1', name: 'B.epub', format: 'epub', size: 1, series: '連作' },
			{ id: 's2', name: 'A.epub', format: 'epub', size: 1, series: '連作' },
		]
		const latest = selectHistoryEntries(volumes, { s1: 10, s2: 50 })
		expect(latest).toHaveLength(1)
		if (latest[0]?.kind !== 'series')
			throw new Error('unexpected history entry kind')
		expect(latest[0].series).toBe('連作')
		expect(latest[0].representative.id).toBe('s2')
		expect(latest[0].readAt).toBe(50)
		const tiedSameSeries = selectHistoryEntries(volumes, { s1: 50, s2: 50 })
		expect(tiedSameSeries).toHaveLength(1)
		if (tiedSameSeries[0]?.kind !== 'series')
			throw new Error('unexpected history entry kind')
		expect(tiedSameSeries[0].representative.id).toBe('s1')
		const sameTime: CloudBook[] = [
			{ id: 'a-t', name: 'A.epub', format: 'epub', size: 1, series: '同刻' },
			{ id: 'm-t', name: 'B.epub', format: 'epub', size: 1, series: '同刻' },
		]
		const tied = selectHistoryEntries(sameTime, { 'a-t': 50, 'm-t': 50 })
		expect(tied).toHaveLength(1)
		if (tied[0]?.kind !== 'series')
			throw new Error('unexpected history entry kind')
		expect(tied[0].representative.id).toBe('a-t')
		expect(tied[0].readAt).toBe(50)
	})

	test('breaks read-time ties by name and id for stable mixed ordering', () => {
		const tied: CloudBook[] = [
			{ id: 'z', name: '同じ題名.epub', format: 'epub', size: 1 },
			{ id: 'a', name: '同じ題名.epub', format: 'epub', size: 1 },
		]
		const entries = selectHistoryEntries(tied, { z: 5, a: 5 })
		expect(
			entries.map((entry) =>
				entry.kind === 'book' ? entry.book.id : entry.series,
			),
		).toEqual(['a', 'z'])
	})

	test('formats the read time for Japanese display and rejects invalid input', () => {
		const timestamp = Date.UTC(2026, 4, 1, 12, 30)
		const formatted = formatReadAt(timestamp)
		expect(formatted).toContain(String(new Date(timestamp).getFullYear()))
		expect(formatted).toMatch(/\d{1,4}\/\d{1,2}\/\d{1,2}/)
		expect(formatReadAt(0)).toBe('')
		expect(formatReadAt(-1)).toBe('')
		expect(formatReadAt(Number.NaN)).toBe('')
		expect(formatReadAt(Number.MAX_SAFE_INTEGER)).toBe('')
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

import { describe, expect, test } from 'vite-plus/test'

import { parsePosition, parseRecency } from './recency'

describe('reading recency parsing', () => {
	test('accepts well-formed positions and rejects malformed entries', () => {
		expect(parsePosition({ bookId: 'a', updatedAt: 1_800_000_000 })).toEqual([
			'a',
			1_800_000_000_000,
		])
		expect(parsePosition(null)).toBeUndefined()
		expect(parsePosition({ bookId: 42, updatedAt: 100 })).toBeUndefined()
		expect(parsePosition({ bookId: 'a', updatedAt: '100' })).toBeUndefined()
		expect(parsePosition({ bookId: 'a', updatedAt: -1 })).toBeUndefined()
		expect(parsePosition({ bookId: 'a', updatedAt: 1.5 })).toBeUndefined()
		expect(
			parseRecency({
				positions: [
					{ bookId: 'a', updatedAt: 1_800_000_000 },
					{ bookId: 'b', updatedAt: -1 },
					'not-a-position',
				],
			}),
		).toEqual({ a: 1_800_000_000_000 })
		expect(parseRecency({ positions: [] })).toEqual({})
		expect(parseRecency({ positions: 'nope' })).toBeUndefined()
		expect(parseRecency(null)).toBeUndefined()
	})

	test('excludes timestamps outside the Date range so history rendering never throws', () => {
		expect(
			parsePosition({ bookId: 'a', updatedAt: 8_640_000_000_000 }),
		).toEqual(['a', 8_640_000_000_000_000])
		expect(
			parsePosition({ bookId: 'a', updatedAt: 8_640_000_000_001 }),
		).toBeUndefined()
		expect(
			parsePosition({ bookId: 'a', updatedAt: Number.MAX_SAFE_INTEGER }),
		).toBeUndefined()
	})
})

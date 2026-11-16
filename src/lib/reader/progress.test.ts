import { describe, expect, test } from 'bun:test'

import {
	progressLocation,
	progressRemaining,
	progressValue,
} from '#lib/reader/progress'

describe('progressValue', () => {
	test('rounds ordinary progress and clamps the lower bound', () => {
		expect(progressValue(42.4, false)).toBe(42)
		expect(progressValue(42.5, false)).toBe(43)
		expect(progressValue(-4, false)).toBe(0)
	})

	test('caps unfinished reading and normalizes invalid values', () => {
		expect(progressValue(100, false)).toBe(99)
		expect(progressValue(Number.NaN, false)).toBe(0)
		expect(progressValue(Number.POSITIVE_INFINITY, false)).toBe(0)
	})

	test('allows completion only at the final boundary', () => {
		expect(progressValue(62, true)).toBe(100)
		expect(progressValue(98.6, false)).toBe(99)
	})
})

describe('progress labels', () => {
	test('describes single pages and visible spreads', () => {
		expect(progressLocation(10, 2, [2])).toBe('3/10')
		expect(progressRemaining(10, 2, [2])).toBe('あと7ページ')
		expect(progressLocation(10, 4, [4, 5])).toBe('5–6/10')
		expect(progressRemaining(10, 4, [4, 5])).toBe('あと4ページ')
	})

	test('describes the final page and handles empty indices or unknown totals', () => {
		expect(progressLocation(8, 7, [7])).toBe('8/8')
		expect(progressRemaining(8, 7, [7])).toBe('あと0ページ')
		expect(progressLocation(8, 3, [])).toBe('4/8')
		expect(progressRemaining(8, 3, [])).toBe('あと4ページ')
		expect(progressLocation(0, 3, [])).toBe('本全体の目安')
		expect(progressRemaining(0, 3, [])).toBe('')
	})
})

import { describe, expect, test } from 'bun:test'

import { progressValue } from '#lib/reader/progress'

describe('progressValue', () => {
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

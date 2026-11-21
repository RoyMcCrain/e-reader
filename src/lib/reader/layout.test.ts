import { describe, expect, test } from 'vite-plus/test'

import { columnsForWidth, nextLead, visibleIndices } from '#lib/reader/layout'

describe('responsive reader layout', () => {
	test('auto layout changes at the content-width threshold', () => {
		expect(columnsForWidth('auto', 719)).toBe(1)
		expect(columnsForWidth('auto', 720)).toBe(2)
	})

	test('explicit modes take precedence at narrow and wide widths', () => {
		expect(columnsForWidth('single', 390)).toBe(1)
		expect(columnsForWidth('single', 1100)).toBe(1)
		expect(columnsForWidth('double', 390)).toBe(2)
		expect(columnsForWidth('double', 1100)).toBe(2)
	})

	test('single and spread turns advance by their visible indices', () => {
		expect(visibleIndices(1, 5, 1)).toEqual([1])
		expect(nextLead(1, 5, 1)).toBe(2)
		expect(visibleIndices(0, 5, 2)).toEqual([0, 1])
		expect(nextLead(0, 5, 2)).toBe(2)
	})

	test('visible indices stay within empty and odd trailing bounds', () => {
		expect(visibleIndices(0, 0, 2)).toEqual([])
		expect(visibleIndices(5, 5, 2)).toEqual([])
		expect(visibleIndices(4, 5, 2)).toEqual([4])
		expect(nextLead(4, 5, 2)).toBe(4)
	})

	test('spread turns preserve the lead when the visible spread already reaches the end', () => {
		expect(visibleIndices(3, 5, 2)).toEqual([3, 4])
		expect(nextLead(3, 5, 2)).toBe(3)
		expect(visibleIndices(4, 6, 2)).toEqual([4, 5])
		expect(nextLead(4, 6, 2)).toBe(4)
	})
})

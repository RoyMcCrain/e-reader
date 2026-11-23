import { describe, expect, test } from 'vite-plus/test'

import { parseSeriesName } from './metadata'

describe('parseSeriesName', () => {
	test('keeps exact series names including URL-sensitive punctuation', () => {
		expect(parseSeriesName('星の旅 A/B #?%')).toBe('星の旅 A/B #?%')
		expect(parseSeriesName('あ'.repeat(240))).toBe('あ'.repeat(240))
	})

	test('rejects missing, blank, control-character and overlong names', () => {
		expect(parseSeriesName(undefined)).toBeUndefined()
		expect(parseSeriesName(['星の旅'])).toBeUndefined()
		expect(parseSeriesName('  ')).toBeUndefined()
		expect(parseSeriesName('星\nの旅')).toBeUndefined()
		expect(parseSeriesName('あ'.repeat(241))).toBeUndefined()
	})
})

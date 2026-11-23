import { describe, expect, test } from 'vite-plus/test'

import { parseAuthorName, parseSeriesName } from './metadata'

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

describe('parseAuthorName', () => {
	test('trims a single-line author name', () => {
		expect(parseAuthorName('  星野 文  ')).toBe('星野 文')
	})

	test('rejects missing, blank, control-character and overlong names', () => {
		expect(parseAuthorName(undefined)).toBeUndefined()
		expect(parseAuthorName(['星野 文'])).toBeUndefined()
		expect(parseAuthorName('  ')).toBeUndefined()
		expect(parseAuthorName('星野\n文')).toBeUndefined()
		expect(parseAuthorName('星野 文\n')).toBeUndefined()
		expect(parseAuthorName('あ'.repeat(241))).toBeUndefined()
	})
})

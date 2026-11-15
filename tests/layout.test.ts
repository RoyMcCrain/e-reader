import { describe, expect, test } from 'bun:test'
import {
  columnsForWidth,
  nextLead,
  visibleIndices,
} from '../src/lib/reader/layout'

describe('responsive reader layout', () => {
  test('auto layout changes at the content-width threshold', () => {
    expect(columnsForWidth('auto', 719)).toBe(1)
    expect(columnsForWidth('auto', 720)).toBe(2)
    expect(columnsForWidth('single', 900)).toBe(1)
    expect(columnsForWidth('double', 390)).toBe(2)
  })

  test('spread turns preserve the lead when the visible spread already reaches the end', () => {
    expect(visibleIndices(3, 5, 2)).toEqual([3, 4])
    expect(nextLead(3, 5, 2)).toBe(3)
    expect(visibleIndices(4, 6, 2)).toEqual([4, 5])
    expect(nextLead(4, 6, 2)).toBe(4)
    expect(visibleIndices(4, 5, 2)).toEqual([4])
    expect(nextLead(4, 5, 2)).toBe(4)
  })
})

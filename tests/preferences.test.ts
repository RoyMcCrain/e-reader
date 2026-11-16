import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  SETTINGS_KEY,
} from '#lib/reader/preferences'

describe('reader settings normalization', () => {
  test('defaults first-page single-cover display on and preserves explicit false', () => {
    expect(DEFAULT_SETTINGS.firstPageSingle).toBe(true)
    expect(normalizeSettings({ firstPageSingle: false }).firstPageSingle).toBe(
      false,
    )
    expect(
      normalizeSettings({ firstPageSingle: 'false' }).firstPageSingle,
    ).toBe(true)
  })
  test('clamps finite numbers to supported limits and preserves enum choices', () => {
    expect(
      normalizeSettings({
        fontFamily: 'serif',
        fontSize: 99,
        lineHeight: 0,
        marginTop: -2,
        marginRight: 120,
        gutter: 70,
        spread: 'double',
        firstPageSingle: false,
      }),
    ).toMatchObject({
      fontFamily: 'serif',
      fontSize: 36,
      lineHeight: 1.2,
      marginTop: 0,
      marginRight: 96,
      gutter: 64,
      spread: 'double',
      firstPageSingle: false,
    })
  })

  test('uses defaults for malformed values and invalid enums', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(
      normalizeSettings({
        fontSize: Number.NaN,
        lineHeight: '2',
        spread: 'wide',
        firstPageSingle: 'false',
      }),
    ).toEqual(DEFAULT_SETTINGS)
    expect(SETTINGS_KEY).toBe('shiori.reader.settings.v1')
  })
})

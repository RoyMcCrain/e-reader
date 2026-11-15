export interface ReaderSettings {
  fontFamily: 'publisher' | 'serif' | 'sans-serif'
  fontSize: number
  lineHeight: number
  marginTop: number
  marginRight: number
  marginBottom: number
  marginLeft: number
  spread: 'auto' | 'single' | 'double'
  gutter: number
}

export const DEFAULT_SETTINGS = {
  fontFamily: 'publisher',
  fontSize: 18,
  lineHeight: 1.8,
  marginTop: 8,
  marginRight: 8,
  marginBottom: 8,
  marginLeft: 8,
  spread: 'auto',
  gutter: 16,
} satisfies ReaderSettings

export const SETTINGS_KEY = 'shiori.reader.settings.v1'

const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback

export const normalizeSettings = (value: unknown): ReaderSettings => {
  const input = value && typeof value === 'object' ? value : {}
  const settings = input as Partial<Record<keyof ReaderSettings, unknown>>
  return {
    fontFamily:
      settings.fontFamily === 'serif' || settings.fontFamily === 'sans-serif'
        ? settings.fontFamily
        : 'publisher',
    fontSize: bounded(settings.fontSize, DEFAULT_SETTINGS.fontSize, 12, 36),
    lineHeight: bounded(
      settings.lineHeight,
      DEFAULT_SETTINGS.lineHeight,
      1.2,
      2.4,
    ),
    marginTop: bounded(settings.marginTop, DEFAULT_SETTINGS.marginTop, 0, 96),
    marginRight: bounded(
      settings.marginRight,
      DEFAULT_SETTINGS.marginRight,
      0,
      96,
    ),
    marginBottom: bounded(
      settings.marginBottom,
      DEFAULT_SETTINGS.marginBottom,
      0,
      96,
    ),
    marginLeft: bounded(
      settings.marginLeft,
      DEFAULT_SETTINGS.marginLeft,
      0,
      96,
    ),
    spread:
      settings.spread === 'single' || settings.spread === 'double'
        ? settings.spread
        : 'auto',
    gutter: bounded(settings.gutter, DEFAULT_SETTINGS.gutter, 0, 64),
  }
}

export const readSettings = () => {
  try {
    const stored = globalThis.localStorage?.getItem(SETTINGS_KEY)
    return stored ? normalizeSettings(JSON.parse(stored)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export const writeSettings = (value: unknown) => {
  try {
    globalThis.localStorage?.setItem(
      SETTINGS_KEY,
      JSON.stringify(normalizeSettings(value)),
    )
  } catch {
    // Storage can be disabled or full; in-memory settings remain usable.
  }
}

import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
	DEFAULT_SETTINGS,
	normalizeSettings,
	readSettings,
	SETTINGS_KEY,
	writeSettings,
} from '#lib/reader/preferences'

const storageDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	'localStorage',
)

afterEach(() => {
	if (storageDescriptor)
		Object.defineProperty(globalThis, 'localStorage', storageDescriptor)
	else Reflect.deleteProperty(globalThis, 'localStorage')
})

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const installStorage = (storage: SettingsStorage | undefined) => {
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: storage,
	})
}

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

	test('uses defaults at missing and lower/upper numeric bounds', () => {
		expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
		expect(
			normalizeSettings({
				fontSize: 12,
				lineHeight: 2.4,
				marginBottom: 0,
				marginLeft: 96,
				gutter: 0,
				spread: 'single',
				fontFamily: 'sans-serif',
			}),
		).toMatchObject({
			fontSize: 12,
			lineHeight: 2.4,
			marginBottom: 0,
			marginLeft: 96,
			gutter: 0,
			spread: 'single',
			fontFamily: 'sans-serif',
		})
	})
})

describe('settings storage boundary', () => {
	test('falls back for malformed JSON and absent or blocked storage', () => {
		installStorage({ getItem: () => '{bad json', setItem: () => {} })
		expect(readSettings()).toEqual(DEFAULT_SETTINGS)
		installStorage({ getItem: () => null, setItem: () => {} })
		expect(readSettings()).toEqual(DEFAULT_SETTINGS)
		installStorage(undefined)
		expect(readSettings()).toEqual(DEFAULT_SETTINGS)
		expect(() => writeSettings(DEFAULT_SETTINGS)).not.toThrow()
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get: () => {
				throw new Error('storage blocked')
			},
		})
		expect(readSettings()).toEqual(DEFAULT_SETTINGS)
		writeSettings(DEFAULT_SETTINGS)
	})

	test('normalizes values read from and written to storage', () => {
		let stored = JSON.stringify({ fontSize: 90, spread: 'double' })
		const storage = {
			getItem: (key: string) => (key === SETTINGS_KEY ? stored : null),
			setItem: (key: string, value: string) => {
				if (key === SETTINGS_KEY) stored = value
			},
		}
		installStorage(storage)
		expect(readSettings()).toMatchObject({ fontSize: 36, spread: 'double' })
		writeSettings({ fontSize: 7, firstPageSingle: false })
		expect(JSON.parse(stored)).toEqual({
			...DEFAULT_SETTINGS,
			fontSize: 12,
			firstPageSingle: false,
		})
	})

	test('ignores storage write failures', () => {
		installStorage({
			getItem: () => null,
			setItem: () => {
				throw new Error('storage blocked')
			},
		})
		expect(() => writeSettings({ fontSize: 24 })).not.toThrow()
	})
})

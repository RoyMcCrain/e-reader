import type { Entry } from '@zip.js/zip.js'
import { describe, expect, test } from 'vite-plus/test'

import { collectZipEntries } from '#lib/reader/zip-entries'

// The collector only consumes metadata; these fixtures intentionally omit ZIP methods.
const entry = (filename: string, uncompressedSize: number) =>
	({ filename, uncompressedSize }) as Entry

const entries = async function* (items: Entry[]) {
	for (const item of items) yield item
}

describe('collectZipEntries', () => {
	test('accepts exact entry-count and expanded-size bounds', async () => {
		const countBound = Array.from({ length: 5000 }, (_, index) =>
			entry(`${index}.txt`, 0),
		)
		const sizeBound = entry('large.txt', 1_000_000_000)
		expect(await collectZipEntries(entries(countBound))).toEqual(countBound)
		expect(await collectZipEntries(entries([sizeBound]))).toEqual([sizeBound])
	})

	test('stops iteration on cumulative size overflow with the caller error', async () => {
		let closed = false
		let finish!: () => void
		const iteratorClosed = new Promise<void>((resolve) => {
			finish = resolve
		})
		const source = async function* () {
			try {
				yield entry('first.txt', 600_000_000)
				yield entry('second.txt', 400_000_001)
				throw new Error('must not request another ZIP entry')
			} finally {
				closed = true
				finish()
			}
		}
		const failure = new Error('custom EPUB limit')
		await expect(collectZipEntries(source(), failure.message)).rejects.toThrow(
			failure,
		)
		await iteratorClosed
		expect(closed).toBe(true)
	})

	test('propagates iterator errors unchanged', async () => {
		const failure = new Error('ZIP enumeration failed')
		const source = async function* () {
			yield entry('first.txt', 1)
			throw failure
		}
		await expect(collectZipEntries(source())).rejects.toBe(failure)
	})
})

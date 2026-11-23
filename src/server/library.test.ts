import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
	accessEnv,
	fixedNow,
	requestFor,
	resetJwks,
	setupJwks,
	tokenFor,
} from '#server/access-fixture.ts'
import { handleLibrary, type LibraryEnv } from '#server/library.ts'

const id = 'a'.repeat(64)
// Manifest metadata deliberately differs from the 3-byte download bodies.
const record = { id, name: "O'Brian!(1).zip", format: 'zip', size: 4 }

const bucketFor = (objects: Record<string, string | Uint8Array> = {}) => {
	const gets: string[] = []
	const puts: { key: string; value: Uint8Array }[] = []
	const bucket = {
		get: async (key: string) => {
			gets.push(key)
			const value = objects[key]
			if (value === undefined) return null
			const bytes =
				typeof value === 'string' ? new TextEncoder().encode(value) : value
			return {
				body: new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(bytes)
						controller.close()
					},
				}),
				size: bytes.byteLength,
				text: async () => new TextDecoder().decode(bytes),
			}
		},
		put: async (key: string, value: Uint8Array) => {
			puts.push({ key, value })
			objects[key] = value
		},
	}
	return { bucket, gets, puts }
}

const zipOf = async (name: string, bytes: Uint8Array) => {
	const writer = new ZipWriter(new Uint8ArrayWriter())
	await writer.add(name, new Uint8ArrayReader(bytes), { level: 0 })
	return writer.close()
}

const envFor = (
	bucket: LibraryEnv['BOOKS'],
	overrides: Partial<LibraryEnv> = {},
): LibraryEnv => ({
	...accessEnv(),
	BOOKS: bucket,
	...overrides,
})

const authorized = async (path: string, method = 'GET') =>
	requestFor(path, await tokenFor()).then(
		(request) => new Request(request, { method }),
	)

const failureHeaders = (result: Response) => {
	expect(result.headers.get('Cache-Control')).toBe('private, no-store')
	expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff')
}

describe('handleLibrary', () => {
	beforeEach(setupJwks)
	afterEach(resetJwks)

	test('accepts manifest boundaries, lists only public fields, and handles a missing manifest', async () => {
		const boundaryBook = {
			...record,
			name: `${'x'.repeat(236)}.zip`,
			size: Number.MAX_SAFE_INTEGER,
		}
		const metadataBook = {
			...boundaryBook,
			series: '  星の旅  ',
			uploadedAt: '2025-03-04T05:06:07.08Z',
			hasCover: true,
			secret: 'omit',
		}
		const secondBook = {
			...record,
			id: 'b'.repeat(64),
			series: '星'.repeat(240),
			uploadedAt: '2025-03-04T05:06:07Z',
		}
		const fixture = bucketFor({
			'library.json': JSON.stringify({
				books: [metadataBook, secondBook],
			}),
		})
		const listed = await handleLibrary(
			await authorized('/api/books'),
			envFor(fixture.bucket),
		)
		expect(listed.status).toBe(200)
		expect(listed.headers.get('Content-Type')).toContain('application/json')
		expect(await listed.json()).toEqual({
			books: [
				{
					...boundaryBook,
					series: '星の旅',
					uploadedAt: '2025-03-04T05:06:07.08Z',
					hasCover: true,
				},
				secondBook,
			],
		})
		failureHeaders(listed)

		const empty = await handleLibrary(
			await authorized('/api/books'),
			envFor(bucketFor().bucket),
		)
		expect(await empty.json()).toEqual({ books: [] })

		const legacy = await handleLibrary(
			await authorized('/api/books'),
			envFor(
				bucketFor({ 'library.json': JSON.stringify({ books: [record] }) })
					.bucket,
			),
		)
		expect(await legacy.json()).toEqual({ books: [record] })
	})

	test('streams listed ZIP and EPUB objects with format-specific headers', async () => {
		const bytes = new Uint8Array([9, 8, 7])
		const epub = {
			...record,
			id: 'b'.repeat(64),
			name: 'A book.epub',
			format: 'epub',
		}
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [record, epub] }),
			[`books/${id}.zip`]: bytes,
			[`books/${epub.id}.epub`]: bytes,
		})
		const zip = await handleLibrary(
			await authorized(`/api/books/${id}`),
			envFor(fixture.bucket),
		)
		expect(new Uint8Array(await zip.arrayBuffer())).toEqual(bytes)
		expect(zip.status).toBe(200)
		expect(zip.headers.get('Content-Type')).toBe('application/zip')
		expect(zip.headers.get('Content-Length')).toBe('3')
		expect(zip.headers.get('Content-Disposition')).toBe(
			"attachment; filename*=UTF-8''O%27Brian%21%281%29.zip",
		)
		failureHeaders(zip)

		const epubResult = await handleLibrary(
			await authorized(`/api/books/${epub.id}`),
			envFor(fixture.bucket),
		)
		expect(epubResult.status).toBe(200)
		expect(new Uint8Array(await epubResult.arrayBuffer())).toEqual(bytes)
		expect(epubResult.headers.get('Content-Type')).toBe('application/epub+zip')
		expect(epubResult.headers.get('Content-Length')).toBe('3')
		expect(epubResult.headers.get('Content-Disposition')).toContain(
			'A%20book.epub',
		)
		failureHeaders(epubResult)
	})

	test('rejects invalid manifest entries, shapes, and duplicate IDs', async () => {
		const invalid = [
			{ ...record, id: 'A'.repeat(64) },
			{ ...record, id: 'a'.repeat(65) },
			{ ...record, name: '../escape.zip' },
			{ ...record, name: 'wrong.epub' },
			{ ...record, name: 'bad\\name.zip' },
			{ ...record, name: 'bad\nname.zip' },
			{ ...record, name: `${'x'.repeat(237)}.zip` },
			{ ...record, format: 'pdf', name: 'book.pdf' },
			{ ...record, size: 0 },
			{ ...record, size: Number.MAX_SAFE_INTEGER + 1 },
			{ ...record, series: '   ' },
			{ ...record, series: '星\u0085の旅' },
			{ ...record, series: `s${'x'.repeat(240)}` },
			{ ...record, uploadedAt: '2025-02-30T00:00:00Z' },
			{ ...record, uploadedAt: '2025-01-01' },
			{ ...record, uploadedAt: '2025-03-04T14:06:07+09:00' },
			{ ...record, hasCover: 'yes' },
			{ ...record, hasCover: null },
			null,
			42,
		]
		for (const manifest of [
			...invalid.map((book) => ({ books: [book] })),
			{ books: [record, invalid[0]] },
			{ books: [record, record] },
			[],
		]) {
			const fixture = bucketFor({ 'library.json': JSON.stringify(manifest) })
			for (const path of ['/api/books', `/api/books/${id}`]) {
				const result = await handleLibrary(
					await authorized(path),
					envFor(fixture.bucket),
				)
				expect(result.status).toBe(503)
				failureHeaders(result)
			}
		}
		const malformed = bucketFor({ 'library.json': '{invalid' })
		for (const path of ['/api/books', `/api/books/${id}`]) {
			const result = await handleLibrary(
				await authorized(path),
				envFor(malformed.bucket),
			)
			expect(result.status).toBe(503)
			failureHeaders(result)
		}
	})

	test('refuses unlisted IDs and malformed download paths without looking up books', async () => {
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [record] }),
		})
		for (const path of [
			`/api/books/${'b'.repeat(64)}`,
			`/api/books/${id}.zip`,
			`/api/books/extra/api/books/${id}`,
			`/api/books/${'A'.repeat(64)}`,
		]) {
			const result = await handleLibrary(
				await authorized(path),
				envFor(fixture.bucket),
			)
			expect(result.status).toBe(404)
			failureHeaders(result)
		}
		expect(fixture.gets).toEqual(['library.json'])
	})

	test('streams a marked cover at the byte limit without reading the book', async () => {
		const webp = new Uint8Array(524_288).fill(7)
		const fixture = bucketFor({
			'library.json': JSON.stringify({
				books: [{ ...record, hasCover: true }],
			}),
			[`books/${id}.zip`]: new Uint8Array([9]),
			[`covers/${id}.webp`]: webp,
		})
		const result = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(result.status).toBe(200)
		expect(new Uint8Array(await result.arrayBuffer())).toEqual(webp)
		expect(result.headers.get('Content-Type')).toBe('image/webp')
		expect(result.headers.get('Content-Length')).toBe('524288')
		expect(result.headers.get('Cross-Origin-Resource-Policy')).toBe(
			'same-origin',
		)
		expect(result.headers.get('Content-Security-Policy')).toBe(
			"default-src 'none'; sandbox",
		)
		failureHeaders(result)
		expect(fixture.gets).toEqual(['library.json', `covers/${id}.webp`])
	})

	test('withholds covers that are unmarked, unlisted, malformed, or outside the byte limit', async () => {
		const marked = { ...record, hasCover: true }
		const manifest = (book: typeof marked | typeof record) =>
			JSON.stringify({ books: [book] })
		const scenarios = [
			{
				name: 'unmarked',
				book: record,
				size: 4,
				path: `/api/books/${id}/cover`,
				reads: [
					'library.json',
					`covers/${id}.webp`,
					`covers/${id}.jpg`,
					`covers/${id}.png`,
					`books/${id}.zip`,
				],
			},
			{
				name: 'missing object',
				book: marked,
				size: undefined,
				path: `/api/books/${id}/cover`,
				reads: ['library.json', `covers/${id}.webp`],
			},
			{
				name: 'oversized',
				book: marked,
				size: 524_289,
				path: `/api/books/${id}/cover`,
				reads: ['library.json', `covers/${id}.webp`],
			},
			{
				name: 'empty',
				book: marked,
				size: 0,
				path: `/api/books/${id}/cover`,
				reads: ['library.json', `covers/${id}.webp`],
			},
			{
				name: 'unlisted',
				book: marked,
				size: 4,
				path: `/api/books/${'b'.repeat(64)}/cover`,
				reads: ['library.json'],
			},
			{
				name: 'uppercase',
				book: marked,
				size: 4,
				path: `/api/books/${'A'.repeat(64)}/cover`,
				reads: [],
			},
		]
		for (const { name, book, size, path, reads } of scenarios) {
			const fixture = bucketFor({
				'library.json': manifest(book),
				...(size === undefined
					? {}
					: { [`covers/${id}.webp`]: new Uint8Array(size) }),
			})
			const result = await handleLibrary(
				await authorized(path),
				envFor(fixture.bucket),
			)
			expect(result.status, name).toBe(404)
			failureHeaders(result)
			expect(fixture.gets, name).toEqual(reads)
		}
		const post = await handleLibrary(
			await authorized(`/api/books/${id}/cover`, 'POST'),
			envFor(bucketFor().bucket),
		)
		expect(post.status).toBe(405)
		expect(post.headers.get('Allow')).toBe('GET')
	})

	test('generates an unmarked cover from the book once, then serves the saved copy', async () => {
		const png = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
		])
		const zip = await zipOf('cover.png', png)
		const zipRecord = { ...record, size: zip.byteLength }
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [zipRecord] }),
			[`books/${id}.zip`]: zip,
		})
		const first = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(first.status).toBe(200)
		expect(new Uint8Array(await first.arrayBuffer())).toEqual(png)
		expect(first.headers.get('Content-Type')).toBe('image/png')
		expect(first.headers.get('Content-Length')).toBe(String(png.byteLength))
		failureHeaders(first)
		expect(fixture.puts).toEqual([{ key: `covers/${id}.png`, value: png }])

		const bookless = bucketFor({
			'library.json': JSON.stringify({ books: [zipRecord] }),
			[`covers/${id}.png`]: png,
		})
		const second = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(bookless.bucket),
		)
		expect(second.status).toBe(200)
		expect(new Uint8Array(await second.arrayBuffer())).toEqual(png)
		expect(second.headers.get('Content-Type')).toBe('image/png')
		expect(bookless.gets).toEqual([
			'library.json',
			`covers/${id}.webp`,
			`covers/${id}.jpg`,
			`covers/${id}.png`,
		])
	})

	test('serves a valid stored webp for unmarked books without reading the book', async () => {
		const webp = new Uint8Array(
			Buffer.from(
				'UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoCAAMAAgA0JQBOgC6gAP7w6MQh1VpbmxIAAA==',
				'base64',
			),
		)
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [record] }),
			[`covers/${id}.webp`]: webp,
		})
		const result = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(result.status).toBe(200)
		expect(new Uint8Array(await result.arrayBuffer())).toEqual(webp)
		expect(result.headers.get('Content-Type')).toBe('image/webp')
		failureHeaders(result)
		expect(fixture.gets).toEqual(['library.json', `covers/${id}.webp`])
		expect(fixture.puts).toEqual([])
	})

	test('ignores a non-webp stored webp key and generates from the book', async () => {
		const png = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
		])
		const zip = await zipOf('cover.png', png)
		const zipRecord = { ...record, size: zip.byteLength }
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [zipRecord] }),
			[`covers/${id}.webp`]: new Uint8Array([1, 2, 3, 4]),
			[`books/${id}.zip`]: zip,
		})
		const result = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(result.status).toBe(200)
		expect(new Uint8Array(await result.arrayBuffer())).toEqual(png)
		expect(result.headers.get('Content-Type')).toBe('image/png')
		failureHeaders(result)
		expect(fixture.puts).toEqual([{ key: `covers/${id}.png`, value: png }])
	})

	test('rejects malformed stored webp keys and generates from the book', async () => {
		const png = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
		])
		const zip = await zipOf('cover.png', png)
		const zipRecord = { ...record, size: zip.byteLength }
		const encode = (value: string) => new TextEncoder().encode(value)
		for (const [name, stored] of [
			['riff without webp', encode('RIFF....AVI ')],
			['webp tag without riff', encode('XXXX....WEBP')],
		] as const) {
			const fixture = bucketFor({
				'library.json': JSON.stringify({ books: [zipRecord] }),
				[`covers/${id}.webp`]: stored,
				[`books/${id}.zip`]: zip,
			})
			const result = await handleLibrary(
				await authorized(`/api/books/${id}/cover`),
				envFor(fixture.bucket),
			)
			expect(result.status, name).toBe(200)
			expect(new Uint8Array(await result.arrayBuffer()), name).toEqual(png)
			expect(result.headers.get('Content-Type'), name).toBe('image/png')
			failureHeaders(result)
			expect(fixture.puts, name).toEqual([
				{ key: `covers/${id}.png`, value: png },
			])
		}
	})

	test('still serves the generated cover when the save fails', async () => {
		const png = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
		])
		const zip = await zipOf('cover.png', png)
		const zipRecord = { ...record, size: zip.byteLength }
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [zipRecord] }),
			[`books/${id}.zip`]: zip,
		})
		fixture.bucket.put = async () => {
			throw new Error('R2 unavailable')
		}
		const result = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(result.status).toBe(200)
		expect(new Uint8Array(await result.arrayBuffer())).toEqual(png)
		expect(result.headers.get('Content-Type')).toBe('image/png')
		failureHeaders(result)
	})

	test('never overwrites an existing webp with a generated one', async () => {
		const webp = new Uint8Array(
			Buffer.from(
				'UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoCAAMAAgA0JQBOgC6gAP7w6MQh1VpbmxIAAA==',
				'base64',
			),
		)
		const zip = await zipOf('cover.webp', webp)
		const zipRecord = { ...record, size: zip.byteLength }
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [zipRecord] }),
			[`covers/${id}.webp`]: new Uint8Array([1, 2, 3, 4]),
			[`books/${id}.zip`]: zip,
		})
		const result = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(result.status).toBe(200)
		expect(new Uint8Array(await result.arrayBuffer())).toEqual(webp)
		expect(result.headers.get('Content-Type')).toBe('image/webp')
		failureHeaders(result)
		expect(fixture.puts).toEqual([])
	})

	test('prefers stored webp over generated formats', async () => {
		const webp = new Uint8Array(
			Buffer.from(
				'UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoCAAMAAgA0JQBOgC6gAP7w6MQh1VpbmxIAAA==',
				'base64',
			),
		)
		const fixture = bucketFor({
			'library.json': JSON.stringify({ books: [record] }),
			[`covers/${id}.webp`]: webp,
			[`covers/${id}.png`]: webp,
		})
		const result = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(result.status).toBe(200)
		expect(new Uint8Array(await result.arrayBuffer())).toEqual(webp)
		expect(result.headers.get('Content-Type')).toBe('image/webp')
		failureHeaders(result)
		expect(fixture.gets).toEqual(['library.json', `covers/${id}.webp`])
		expect(fixture.puts).toEqual([])
	})

	test('refuses to generate from books over the memory limit', async () => {
		const fixture = bucketFor({
			'library.json': JSON.stringify({
				books: [{ ...record, size: 33_554_433 }],
			}),
			[`books/${id}.zip`]: new Uint8Array(33_554_433),
		})
		const result = await handleLibrary(
			await authorized(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect(result.status).toBe(404)
		failureHeaders(result)
		expect(fixture.puts).toEqual([])
	})

	test('returns 404 without writing when the book is missing, broken, or unsupported', async () => {
		const gif = new TextEncoder().encode('GIF89a')
		const cases = [
			{ name: 'missing book', objects: {} },
			{
				name: 'broken book',
				objects: { [`books/${id}.zip`]: new Uint8Array([1, 2, 3]) },
			},
			{
				name: 'unsupported image',
				objects: { [`books/${id}.zip`]: await zipOf('page.gif', gif) },
			},
		]
		for (const { name, objects } of cases) {
			const fixture = bucketFor({
				'library.json': JSON.stringify({ books: [record] }),
				...objects,
			})
			const result = await handleLibrary(
				await authorized(`/api/books/${id}/cover`),
				envFor(fixture.bucket),
			)
			expect(result.status, name).toBe(404)
			failureHeaders(result)
			expect(fixture.puts, name).toEqual([])
		}
	})

	test('returns controlled errors for missing objects and R2 lookup failures', async () => {
		const missing = bucketFor({
			'library.json': JSON.stringify({ books: [record] }),
		})
		const notFound = await handleLibrary(
			await authorized(`/api/books/${id}`),
			envFor(missing.bucket),
		)
		expect(notFound.status).toBe(404)
		failureHeaders(notFound)

		const detail = 'private storage detail'
		const failingBucket = {
			get: async () => {
				throw new Error(detail)
			},
			put: async () => undefined,
		}
		const failed = await handleLibrary(
			await authorized('/api/books'),
			envFor(failingBucket),
		)
		expect(failed.status).toBe(503)
		expect(await failed.text()).not.toContain(detail)
		failureHeaders(failed)
	})

	test('enforces manifest entry and byte-size resource limits', async () => {
		const books = Array.from({ length: 10_000 }, (_, index) => ({
			...record,
			id: index.toString(16).padStart(64, '0'),
		}))
		const exactLimit = JSON.stringify({ books: [] }).padEnd(4_194_304, ' ')
		const maximumEntries = await handleLibrary(
			await authorized('/api/books'),
			envFor(bucketFor({ 'library.json': JSON.stringify({ books }) }).bucket),
		)
		expect(maximumEntries.status).toBe(200)

		const tooMany = await handleLibrary(
			await authorized('/api/books'),
			envFor(
				bucketFor({
					'library.json': JSON.stringify({
						books: [...books, { ...record, id: 'f'.repeat(64) }],
					}),
				}).bucket,
			),
		)
		expect(tooMany.status).toBe(503)

		const byteLimit = await handleLibrary(
			await authorized('/api/books'),
			envFor(bucketFor({ 'library.json': exactLimit }).bucket),
		)
		expect(byteLimit.status).toBe(200)
		const overLimit = await handleLibrary(
			await authorized('/api/books'),
			envFor(bucketFor({ 'library.json': `${exactLimit} ` }).bucket),
		)
		expect(overLimit.status).toBe(503)
	})

	test('rejects invalid JWTs at the API boundary before storage access', async () => {
		const fixture = bucketFor()
		const valid = await tokenFor()
		const [header, payload, signature] = valid.split('.')
		const tampered = `${header}.${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`
		const invalidTokens = [
			['tampered signature', tampered],
			['expired', await tokenFor({ exp: fixedNow / 1000 })],
			['wrong audience', await tokenFor({ aud: 'foreign-audience' })],
			[
				'wrong issuer',
				await tokenFor({ iss: 'https://foreign.cloudflareaccess.com' }),
			],
		] as const

		for (const [category, token] of invalidTokens) {
			const result = await handleLibrary(
				await requestFor('/api/books', token),
				envFor(fixture.bucket),
			)
			expect(result.status, category).toBe(401)
		}
		expect(fixture.gets).toEqual([])
	})

	test('denies spoofed identity, other owners, and service tokens before storage access', async () => {
		const fixture = bucketFor()
		const spoofed = await handleLibrary(
			new Request('https://reader.example/api/books', {
				headers: { 'Cf-Access-Email': 'owner@example.com' },
			}),
			envFor(fixture.bucket),
		)
		const otherOwner = await handleLibrary(
			await requestFor(
				'/api/books',
				await tokenFor({ email: 'other@example.com' }),
			),
			envFor(fixture.bucket),
		)
		const serviceToken = await tokenFor({ email: undefined })
		const serviceStatuses = await Promise.all([
			handleLibrary(
				await requestFor('/api/books', serviceToken),
				envFor(fixture.bucket),
			),
			handleLibrary(
				await requestFor(`/api/books/${id}`, serviceToken),
				envFor(fixture.bucket),
			),
		])
		expect([spoofed.status, otherOwner.status]).toEqual([401, 403])
		expect(serviceStatuses.map(({ status }) => status)).toEqual([403, 403])
		expect(fixture.gets).toEqual([])
	})

	test('fails closed for absent API configuration before storage access', async () => {
		const fixture = bucketFor()
		const token = await tokenFor()
		const responses = await Promise.all([
			handleLibrary(
				await requestFor('/api/books', token),
				envFor(fixture.bucket, { ACCESS_AUD: undefined }),
			),
			handleLibrary(
				await requestFor('/api/books', token),
				envFor(fixture.bucket, { ACCESS_ALLOWED_EMAIL: undefined }),
			),
			handleLibrary(
				await requestFor(`/api/books/${id}`, token),
				envFor(fixture.bucket, { ACCESS_ALLOWED_EMAIL: '' }),
			),
		])
		expect(responses.map(({ status }) => status)).toEqual([503, 503, 503])
		expect(fixture.gets).toEqual([])
	})

	test('returns a private controlled error when listed body lookup rejects', async () => {
		const detail = 'private body lookup detail'
		const bucket = {
			get: async (key: string) => {
				if (key === `books/${id}.zip`) throw new Error(detail)
				return bucketFor({
					'library.json': JSON.stringify({ books: [record] }),
				}).bucket.get(key)
			},
			put: async () => undefined,
		}
		const result = await handleLibrary(
			await authorized(`/api/books/${id}`),
			envFor(bucket),
		)
		expect(result.status).toBe(503)
		expect(await result.text()).not.toContain(detail)
		failureHeaders(result)
	})

	test('checks the route and authorization before touching storage; advertises GET only', async () => {
		const fixture = bucketFor()
		const outside = await handleLibrary(
			await requestFor('/private'),
			envFor(fixture.bucket),
		)
		const anonymous = await handleLibrary(
			await requestFor('/api/books'),
			envFor(fixture.bucket),
		)
		const method = await handleLibrary(
			await authorized('/api/books', 'POST'),
			envFor(fixture.bucket),
		)
		const anonymousCover = await handleLibrary(
			await requestFor(`/api/books/${id}/cover`),
			envFor(fixture.bucket),
		)
		expect([outside.status, anonymous.status, method.status]).toEqual([
			404, 401, 405,
		])
		expect(anonymousCover.status).toBe(401)
		expect(method.headers.get('Allow')).toBe('GET')
		expect(fixture.gets).toEqual([])
	})
})

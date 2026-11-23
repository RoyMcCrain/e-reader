import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Miniflare } from 'miniflare'

import { handleLibrary, type LibraryEnv } from '#server/library.ts'

void test('lists and streams a book from Miniflare R2 with private headers', async () => {
	const team = 'reader-r2-test.cloudflareaccess.com'
	const issuer = `https://${team}`
	const miniflare = new Miniflare({
		workers: [
			{
				config: {
					name: 'test',
					compatibilityDate: '2026-11-14',
					env: { BOOKS: { type: 'r2', name: 'test' } },
				},
				legacy: { serviceWorkerScript: 'addEventListener("fetch", () => {})' },
			},
		],
	})
	const originalFetch = globalThis.fetch
	try {
		const pair = await generateKeyPair('RS256')
		const jwk = await exportJWK(pair.publicKey)
		Object.assign(jwk, { kid: 'r2-key', alg: 'RS256', use: 'sig' })
		const bucket = await miniflare.getR2Bucket('BOOKS')
		const id = 'a'.repeat(64)
		const bytes = new TextEncoder().encode('Café ebook bytes')
		const book = {
			id,
			name: 'Café.epub',
			format: 'epub',
			size: bytes.length,
			hasCover: true,
		}
		const cover = new Uint8Array(
			Buffer.from(
				'UklGRiwAAABXRUJQVlA4ICAAAABQAQCdASoCAAMAAgA0JQBOgC6gAP7w6MQh1VpbmxIAAA==',
				'base64',
			),
		)
		await bucket.put(`books/${id}.epub`, bytes)
		await bucket.put(`covers/${id}.webp`, cover)
		await bucket.put('library.json', JSON.stringify({ books: [book] }))
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(
				input instanceof Request ? input.url : input.toString(),
			)
			if (url.href === `${issuer}/cdn-cgi/access/certs`)
				return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] })))
			if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
				return originalFetch(input, init)
			throw new Error(`Unexpected external fetch: ${url.origin}`)
		}) as typeof fetch

		const now = Math.floor(Date.now() / 1000)
		const token = await new SignJWT({ email: 'owner@example.com' })
			.setProtectedHeader({ alg: 'RS256', kid: 'r2-key' })
			.setIssuer(issuer)
			.setAudience('r2-audience')
			.setSubject('r2-user')
			.setIssuedAt(now)
			.setExpirationTime(now + 300)
			.sign(pair.privateKey)
		const env = {
			// Miniflare's proxy stream types differ from the app's DOM stream types.
			BOOKS: bucket as LibraryEnv['BOOKS'],
			ACCESS_TEAM_DOMAIN: team,
			ACCESS_AUD: 'r2-audience',
			ACCESS_ALLOWED_EMAIL: 'owner@example.com',
		} satisfies LibraryEnv
		const request = (path: string) =>
			new Request(`https://reader.example${path}`, {
				headers: { 'Cf-Access-Jwt-Assertion': token },
			})

		const listing = await handleLibrary(request('/api/books'), env)
		assert.equal(listing.status, 200)
		assert.deepEqual(await listing.json(), { books: [book] })
		const download = await handleLibrary(request(`/api/books/${id}`), env)
		assert.equal(download.status, 200)
		assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes)
		assert.equal(download.headers.get('Content-Type'), 'application/epub+zip')
		assert.equal(
			download.headers.get('Content-Disposition'),
			"attachment; filename*=UTF-8''Caf%C3%A9.epub",
		)
		assert.equal(download.headers.get('Content-Length'), String(bytes.length))
		assert.equal(download.headers.get('Cache-Control'), 'private, no-store')
		assert.equal(download.headers.get('X-Content-Type-Options'), 'nosniff')
		const thumbnail = await handleLibrary(
			request(`/api/books/${id}/cover`),
			env,
		)
		assert.equal(thumbnail.status, 200)
		assert.deepEqual(new Uint8Array(await thumbnail.arrayBuffer()), cover)
		assert.equal(thumbnail.headers.get('Content-Type'), 'image/webp')
		assert.equal(thumbnail.headers.get('Content-Length'), String(cover.length))
		assert.equal(
			thumbnail.headers.get('Cross-Origin-Resource-Policy'),
			'same-origin',
		)
		assert.equal(
			thumbnail.headers.get('Content-Security-Policy'),
			"default-src 'none'; sandbox",
		)
		assert.equal(thumbnail.headers.get('Cache-Control'), 'private, no-store')
		const generatedId = 'c'.repeat(64)
		const png = new Uint8Array([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
		])
		const writer = new ZipWriter(new Uint8ArrayWriter())
		const text = (value: string) => new TextEncoder().encode(value)
		await writer.add(
			'META-INF/container.xml',
			new Uint8ArrayReader(
				text(
					'<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
				),
			),
			{ level: 0 },
		)
		await writer.add(
			'OEBPS/content.opf',
			new Uint8ArrayReader(
				text(
					'<package><metadata><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="cover.png" media-type="image/png"/></manifest></package>',
				),
			),
			{ level: 0 },
		)
		await writer.add('OEBPS/cover.png', new Uint8ArrayReader(png), {
			level: 0,
		})
		const epub = await writer.close()
		const generatedBook = {
			id: generatedId,
			name: 'Generated.epub',
			format: 'epub',
			size: epub.length,
		}
		await bucket.put(`books/${generatedId}.epub`, epub)
		await bucket.put(
			'library.json',
			JSON.stringify({ books: [book, generatedBook] }),
		)
		const generatedRequest = () =>
			new Request(`https://reader.example/api/books/${generatedId}/cover`, {
				headers: { 'Cf-Access-Jwt-Assertion': token },
			})

		const generated = await handleLibrary(generatedRequest(), env)
		assert.equal(generated.status, 200)
		assert.equal(generated.headers.get('Content-Type'), 'image/png')
		assert.deepEqual(new Uint8Array(await generated.arrayBuffer()), png)
		const saved = await bucket.get(`covers/${generatedId}.png`)
		assert.ok(saved)
		assert.deepEqual(new Uint8Array(await saved.arrayBuffer()), png)

		await bucket.delete(`books/${generatedId}.epub`)
		const afterDelete = await handleLibrary(generatedRequest(), env)
		assert.equal(afterDelete.status, 200)
		assert.deepEqual(new Uint8Array(await afterDelete.arrayBuffer()), png)
	} finally {
		globalThis.fetch = originalFetch
		await miniflare.dispose()
	}
})

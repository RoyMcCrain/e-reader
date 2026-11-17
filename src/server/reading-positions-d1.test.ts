import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'

import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Miniflare } from 'miniflare'

import { handleReadingPosition } from '#server/reading-positions.ts'

const team = 'position-test.cloudflareaccess.com'
const issuer = `https://${team}`
const book = 'a'.repeat(64)
const miniflare = new Miniflare({
	workers: [
		{
			config: {
				name: 'test',
				compatibilityDate: '2026-11-14',
				manifest: {
					mainModule: 'index.js',
					modulesRoot: process.cwd(),
					modules: {
						'index.js': {
							type: 'esm',
							contents: 'export default {fetch(){return new Response("ok")}}',
						},
					},
				},
				env: { DB: { type: 'd1', name: 'test' } },
			},
		},
	],
})
const originalFetch = globalThis.fetch
let privateKey: CryptoKey
let jwk: Awaited<ReturnType<typeof exportJWK>>
let db: Awaited<ReturnType<typeof miniflare.getD1Database>>

before(async () => {
	const pair = await generateKeyPair('RS256')
	privateKey = pair.privateKey
	jwk = await exportJWK(pair.publicKey)
	Object.assign(jwk, { kid: 'position-key', alg: 'RS256', use: 'sig' })
	db = await miniflare.getD1Database('DB')
	await db
		.prepare(
			await readFile(
				'db/migrations/20261116133257_lazy_the_watchers.sql',
				'utf8',
			),
		)
		.run()
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : input.toString()
		return url === `${issuer}/cdn-cgi/access/certs`
			? Promise.resolve(new Response(JSON.stringify({ keys: [jwk] })))
			: originalFetch(input, init)
	}) as typeof fetch
})

after(async () => {
	globalThis.fetch = originalFetch
	await miniflare.dispose()
})

const envFor = () => ({
	DB: db,
	ACCESS_TEAM_DOMAIN: team,
	ACCESS_AUD: 'position-audience',
	ACCESS_ALLOWED_EMAIL: 'owner@example.com',
})

const requestFor = async (
	method: string,
	body?: unknown,
	origin = 'https://reader.rrrr.dev',
	subject = 'reader',
	claims: { email?: string; expiration?: number } = {},
) => {
	const now = Math.floor(Date.now() / 1000)
	const token = await new SignJWT({
		email: claims.email ?? 'owner@example.com',
	})
		.setProtectedHeader({ alg: 'RS256', kid: 'position-key' })
		.setIssuer(issuer)
		.setAudience('position-audience')
		.setSubject(subject)
		.setIssuedAt(now)
		.setExpirationTime(claims.expiration ?? now + 300)
		.sign(privateKey)
	const headers = new Headers({ 'Cf-Access-Jwt-Assertion': token })
	if (method === 'PUT') {
		headers.set('Origin', origin)
		headers.set('Content-Type', 'application/json')
	}
	return new Request(`https://reader.rrrr.dev/api/reading-positions/${book}`, {
		method,
		headers,
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	})
}

const responseData = async (response: Response): Promise<unknown> =>
	response.json()

const handle = async (method: string, body?: unknown, subject = 'reader') =>
	handleReadingPosition(
		await requestFor(method, body, undefined, subject),
		envFor(),
		book,
	)

void test('reads, updates, retries idempotently, and confines rows to authenticated subjects', async () => {
	assert.deepEqual(await responseData(await handle('GET')), { position: null })
	const input = {
		cfi: 'epubcfi(/6/2)',
		baseRevision: 0,
		mutationId: '123e4567-e89b-42d3-a456-426614174000',
	}
	const first = await handle('PUT', input)
	assert.equal(first.status, 200)
	assert.deepEqual(await responseData(first), {
		position: { cfi: input.cfi, revision: 1, mutationId: input.mutationId },
	})
	assert.deepEqual(await responseData(await handle('PUT', input)), {
		position: { cfi: input.cfi, revision: 1, mutationId: input.mutationId },
	})
	const update = {
		cfi: 'epubcfi(/6/4)',
		baseRevision: 1,
		mutationId: '123e4567-e89b-42d3-a456-426614174002',
	}
	const updated = await handle('PUT', update)
	assert.equal(updated.status, 200)
	assert.deepEqual(await responseData(updated), {
		position: { cfi: update.cfi, revision: 2, mutationId: update.mutationId },
	})
	assert.deepEqual(
		await responseData(await handle('GET', undefined, 'other')),
		{
			position: null,
		},
	)
	assert.equal(
		(await handle('PUT', { ...input, cfi: 'epubcfi(/6/4)' })).status,
		409,
	)
	assert.equal(
		(
			await handle('PUT', {
				...update,
				baseRevision: 2,
				cfi: 'epubcfi(/6/6)',
			})
		).status,
		409,
	)
	assert.equal(
		(
			await handle('PUT', {
				...input,
				mutationId: '123e4567-e89b-42d3-a456-426614174001',
				baseRevision: 9,
			})
		).status,
		409,
	)
})

void test('rejects nonzero initial revision without creating a row', async () => {
	const payload = {
		cfi: 'epubcfi(/6/2)',
		baseRevision: 1,
		mutationId: '123e4567-e89b-42d3-a456-426614174010',
	}
	const response = await handle('PUT', payload, 'new-reader')
	assert.equal(response.status, 409)
	assert.deepEqual(
		await responseData(await handle('GET', undefined, 'new-reader')),
		{ position: null },
	)
})

void test('concurrent writes acknowledge only the committed request and duplicate mutations increment once', async () => {
	const base = { cfi: 'epubcfi(/6/2)', baseRevision: 0 }
	const one = { ...base, mutationId: '123e4567-e89b-42d3-a456-426614174020' }
	const two = {
		...base,
		cfi: 'epubcfi(/6/4)',
		mutationId: '123e4567-e89b-42d3-a456-426614174021',
	}
	const results = await Promise.all([
		handle('PUT', one, 'race'),
		handle('PUT', two, 'race'),
	])
	const statuses = results.map(({ status }) => status).sort((a, b) => a - b)
	assert.deepEqual(statuses, [200, 409])
	const successIndex = results.findIndex(({ status }) => status === 200)
	const acknowledged = await responseData(results[successIndex]!.clone())
	const winningInput = successIndex === 0 ? one : two
	assert.deepEqual(acknowledged, {
		position: {
			cfi: winningInput.cfi,
			revision: 1,
			mutationId: winningInput.mutationId,
		},
	})
	assert.deepEqual(
		await responseData(await handle('GET', undefined, 'race')),
		acknowledged,
	)
	const duplicate = {
		...base,
		mutationId: '123e4567-e89b-42d3-a456-426614174022',
	}
	const duplicates = await Promise.all([
		handle('PUT', duplicate, 'duplicates'),
		handle('PUT', duplicate, 'duplicates'),
	])
	assert.deepEqual(
		duplicates.map(({ status }) => status),
		[200, 200],
	)
	assert.deepEqual(
		await responseData(await handle('GET', undefined, 'duplicates')),
		{
			position: {
				cfi: duplicate.cfi,
				revision: 1,
				mutationId: duplicate.mutationId,
			},
		},
	)
})

void test('accepts a long multibyte CFI and stores it exactly', async () => {
	const cfi = `epubcfi(/6/2[${'あ'.repeat(3000)}]!/4/2)`
	assert.ok(cfi.length <= 4096)
	const input = {
		cfi,
		baseRevision: 0,
		mutationId: '123e4567-e89b-42d3-a456-426614174040',
	}
	const response = await handle('PUT', input, 'multibyte-cfi')
	assert.equal(response.status, 200)
	assert.deepEqual(
		await responseData(await handle('GET', undefined, 'multibyte-cfi')),
		{
			position: { cfi, revision: 1, mutationId: input.mutationId },
		},
	)
})

void test('validates write origin, content type, body shape, and rejects spoofed identity', async () => {
	const getResponse = await handle('GET')
	assert.equal(getResponse.headers.get('Cache-Control'), 'private, no-store')
	const methodResponse = await handle('POST')
	assert.equal(methodResponse.status, 405)
	assert.equal(methodResponse.headers.get('Allow'), 'GET, PUT')
	const input = {
		cfi: 'epubcfi(/6/2)',
		baseRevision: 0,
		mutationId: '123e4567-e89b-42d3-a456-426614174030',
	}
	assert.equal(
		(
			await handleReadingPosition(
				await requestFor('PUT', input, 'https://evil.example'),
				envFor(),
				book,
			)
		).status,
		403,
	)
	const badType = await requestFor('PUT', input)
	badType.headers.set('Content-Type', 'application/json-evil')
	assert.equal(
		(await handleReadingPosition(badType, envFor(), book)).status,
		415,
	)
	assert.equal(
		(await handleReadingPosition(await requestFor('PUT', null), envFor(), book))
			.status,
		400,
	)
	const spoofed = new Request(
		`https://reader.rrrr.dev/api/reading-positions/${book}`,
		{ headers: { 'Cf-Access-Email': 'owner@example.com' } },
	)
	assert.equal(
		(await handleReadingPosition(spoofed, envFor(), book)).status,
		401,
	)
	const expired = await requestFor('GET', undefined, undefined, 'reader', {
		expiration: Math.floor(Date.now() / 1000) - 1,
	})
	assert.equal(
		(await handleReadingPosition(expired, envFor(), book)).status,
		401,
	)
	const denied = await requestFor('GET', undefined, undefined, 'reader', {
		email: 'someone@example.com',
	})
	assert.equal(
		(await handleReadingPosition(denied, envFor(), book)).status,
		403,
	)
	const oversizedBody = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(32 * 1024 + 1).fill(32))
			controller.close()
		},
	})
	const oversized = await requestFor('PUT')
	const oversizedRequest = new Request(oversized.url, {
		method: 'PUT',
		headers: oversized.headers,
		body: oversizedBody,
		// Deliberately omit Content-Length: the endpoint must count streamed bytes.
		duplex: 'half',
	} as RequestInit)
	assert.equal(
		(await handleReadingPosition(oversizedRequest, envFor(), book)).status,
		413,
	)
})

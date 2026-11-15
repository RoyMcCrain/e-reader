import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Miniflare } from 'miniflare'
import { handleLibrary, type LibraryEnv } from '#server/library.ts'

const issuer = 'https://reader-library-test.cloudflareaccess.com'
const team = 'reader-library-test.cloudflareaccess.com'
const ids = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)]
const names = ['One.epub', 'Two.zip', 'Café.epub']
const records = ids.map((id, index) => ({
  id,
  name: names[index]!,
  format: index === 1 ? ('zip' as const) : ('epub' as const),
  size: [4, 3, 5][index]!,
}))
const bytes = [
  new Uint8Array([1, 2, 3, 4]),
  new Uint8Array([5, 6, 7]),
  new Uint8Array([8, 9, 10, 11, 12]),
]
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
let privateKey: CryptoKey
let bucket: Awaited<ReturnType<typeof miniflare.getR2Bucket>>
let jwk: Awaited<ReturnType<typeof exportJWK>>

before(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  jwk = await exportJWK(pair.publicKey)
  Object.assign(jwk, { kid: 'library-key', alg: 'RS256', use: 'sig' })
  bucket = await miniflare.getR2Bucket('BOOKS')
  for (const [index, record] of records.entries())
    await bucket.put(`books/${record.id}.${record.format}`, bytes[index]!)
  await bucket.put('library.json', JSON.stringify({ books: records }))
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === `${issuer}/cdn-cgi/access/certs`)
      return Promise.resolve(new Response(JSON.stringify({ keys: [jwk] })))
    return originalFetch(input, init)
  }) as typeof fetch
})

after(async () => {
  globalThis.fetch = originalFetch
  await miniflare.dispose()
})

const authorizedRequest = async (path: string, method = 'GET') => {
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ email: 'me@rrrr.dev' })
    .setProtectedHeader({ alg: 'RS256', kid: 'library-key' })
    .setIssuer(issuer)
    .setAudience('library-audience')
    .setSubject('library-user')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey)
  return new Request(`https://reader.rrrr.dev${path}`, {
    method,
    headers: { 'Cf-Access-Jwt-Assertion': token },
  })
}

const env = () =>
  ({
    BOOKS: bucket,
    ACCESS_TEAM_DOMAIN: team,
    ACCESS_AUD: 'library-audience',
    ACCESS_ALLOWED_EMAIL: 'me@rrrr.dev',
  }) as LibraryEnv

test('lists private records and streams exact R2 bytes with safe headers', async () => {
  const listing = await handleLibrary(
    await authorizedRequest('/api/books'),
    env(),
  )
  assert.equal(listing.status, 200)
  assert.deepEqual(await listing.json(), { books: records })

  const download = await handleLibrary(
    await authorizedRequest(`/api/books/${ids[2]}`),
    env(),
  )
  assert.equal(download.status, 200)
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes[2])
  assert.equal(download.headers.get('Content-Type'), 'application/epub+zip')
  assert.match(
    download.headers.get('Content-Disposition') ?? '',
    /Caf%C3%A9\.epub/,
  )
  assert.equal(download.headers.get('Content-Length'), '5')
  assert.equal(download.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(download.headers.get('X-Content-Type-Options'), 'nosniff')
})

test('whitelists manifest fields and only serves manifest-listed IDs', async () => {
  await bucket.put(
    'library.json',
    JSON.stringify({ books: [{ ...records[0], hidden: 'private metadata' }] }),
  )
  const listing = await handleLibrary(
    await authorizedRequest('/api/books'),
    env(),
  )
  assert.deepEqual(await listing.json(), { books: [records[0]] })
  const unknown = await handleLibrary(
    await authorizedRequest(`/api/books/${'d'.repeat(64)}`),
    env(),
  )
  const malformed = await handleLibrary(
    await authorizedRequest('/api/books/not-a-hash'),
    env(),
  )
  const subpath = await handleLibrary(
    await authorizedRequest(`/api/books/${ids[0]}/extra`),
    env(),
  )
  assert.deepEqual(
    [unknown.status, malformed.status, subpath.status],
    [404, 404, 404],
  )
  await bucket.put('library.json', JSON.stringify({ books: records }))
})

test('returns private service-unavailable response when the listed body lookup rejects', async () => {
  const failingEnv = env()
  const originalGet = failingEnv.BOOKS.get.bind(failingEnv.BOOKS)
  failingEnv.BOOKS = {
    get: (key) =>
      key === `books/${ids[0]}.epub`
        ? Promise.reject(new Error('body lookup failed'))
        : originalGet(key),
  }
  const result = await handleLibrary(
    await authorizedRequest(`/api/books/${ids[0]}`),
    failingEnv,
  )
  assert.equal(result.status, 503)
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store')
  assert.equal(result.headers.get('X-Content-Type-Options'), 'nosniff')
})

test('returns safe errors for missing object, invalid manifest and wrong methods', async () => {
  await bucket.delete(`books/${ids[0]}.epub`)
  const missing = await handleLibrary(
    await authorizedRequest(`/api/books/${ids[0]}`),
    env(),
  )
  assert.equal(missing.status, 404)
  await bucket.put('library.json', '{ invalid')
  const invalidManifest = await handleLibrary(
    await authorizedRequest('/api/books'),
    env(),
  )
  assert.equal(invalidManifest.status, 503)
  assert.equal(
    invalidManifest.headers.get('Cache-Control'),
    'private, no-store',
  )
  const method = await handleLibrary(
    await authorizedRequest('/api/books', 'POST'),
    env(),
  )
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('Allow'), 'GET')
})

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { Miniflare } from 'miniflare'
import { handleLibrary, type LibraryEnv } from '../../src/server/library.ts'

const team = 'reader-test.cloudflareaccess.com'
const issuer = `https://${team}`
const envValues = {
  ACCESS_TEAM_DOMAIN: team,
  ACCESS_AUD: 'test-audience',
  ACCESS_ALLOWED_EMAIL: 'me@rrrr.dev',
}
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
let jwk: Awaited<ReturnType<typeof exportJWK>>
let bucket: Awaited<ReturnType<typeof miniflare.getR2Bucket>>

before(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  jwk = await exportJWK(pair.publicKey)
  Object.assign(jwk, { kid: 'test-key', alg: 'RS256', use: 'sig' })
  bucket = await miniflare.getR2Bucket('BOOKS')
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

const tokenFor = (
  claims: { email?: string; aud?: string; iss?: string; exp?: number } = {},
) => {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ email: claims.email ?? 'me@rrrr.dev' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setSubject('test-user')
    .setIssuer(claims.iss ?? issuer)
    .setAudience(claims.aud ?? 'test-audience')
    .setIssuedAt(now)
    .setExpirationTime(claims.exp ?? now + 300)
    .sign(privateKey)
}

const requestFor = async (path: string, token?: string) => {
  const headers: Record<string, string> = token
    ? { 'Cf-Access-Jwt-Assertion': token }
    : {}
  return new Request(`https://reader.rrrr.dev${path}`, { headers })
}

const testEnv = (overrides: Partial<LibraryEnv> = {}) =>
  ({ ...envValues, BOOKS: bucket, ...overrides }) as LibraryEnv

test('requires verified JWT and does not trust a spoofed email header', async () => {
  const valid = await handleLibrary(
    await requestFor('/api/books', await tokenFor()),
    testEnv(),
  )
  assert.equal(valid.status, 200)
  assert.equal(valid.headers.get('Cache-Control'), 'private, no-store')
  const token = await tokenFor()
  const [header, payload, signature] = token.split('.')
  const changedSignature = `${signature?.[0] === 'A' ? 'B' : 'A'}${signature?.slice(1)}`
  const tamperedToken = `${header}.${payload}.${changedSignature}`
  const tampered = await handleLibrary(
    await requestFor('/api/books', tamperedToken),
    testEnv(),
  )
  const anonymous = await handleLibrary(
    await requestFor('/api/books'),
    testEnv(),
  )
  const spoofed = await handleLibrary(
    new Request('https://reader.rrrr.dev/api/books', {
      headers: { 'Cf-Access-Email': 'me@rrrr.dev' },
    }),
    testEnv(),
  )
  assert.equal(tampered.status, 401)
  assert.equal(anonymous.status, 401)
  assert.equal(spoofed.status, 401)
})

test('rejects wrong identity, expired token, audience and issuer', async () => {
  const now = Math.floor(Date.now() / 1000)
  const statuses = await Promise.all([
    handleLibrary(
      await requestFor(
        '/api/books',
        await tokenFor({ email: 'other@example.com' }),
      ),
      testEnv(),
    ),
    handleLibrary(
      await requestFor('/api/books', await tokenFor({ exp: now - 10 })),
      testEnv(),
    ),
    handleLibrary(
      await requestFor('/api/books', await tokenFor({ aud: 'wrong' })),
      testEnv(),
    ),
    handleLibrary(
      await requestFor(
        '/api/books',
        await tokenFor({ iss: 'https://wrong.cloudflareaccess.com' }),
      ),
      testEnv(),
    ),
  ])
  assert.deepEqual(
    statuses.map(({ status }) => status),
    [403, 401, 401, 401],
  )
})

test('fails closed when required environment is absent', async () => {
  const response = await handleLibrary(
    await requestFor('/api/books', await tokenFor()),
    testEnv({ ACCESS_AUD: undefined }),
  )
  assert.equal(response.status, 503)
})

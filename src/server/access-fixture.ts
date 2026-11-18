import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { vi } from 'vitest'

import type { AccessEnv } from '#server/access.ts'

export const team = 'server-unit.cloudflareaccess.com'
export const issuer = `https://${team}`
export const audience = 'server-unit-audience'
export const owner = 'owner@example.com'
export const fixedNow = 1_800_000_000_000

const keyFixture = (async () => {
	const pair = await generateKeyPair('RS256')
	const jwk = await exportJWK(pair.publicKey)
	Object.assign(jwk, { kid: 'server-unit-key', alg: 'RS256', use: 'sig' })
	return { privateKey: pair.privateKey, jwk }
})()

export const accessEnv = (overrides: Partial<AccessEnv> = {}): AccessEnv => ({
	ACCESS_TEAM_DOMAIN: team,
	ACCESS_AUD: audience,
	ACCESS_ALLOWED_EMAIL: owner,
	...overrides,
})

export const tokenFor = async (claims: Record<string, unknown> = {}) => {
	const { privateKey } = await keyFixture
	return new SignJWT({
		email: owner,
		iss: issuer,
		aud: audience,
		sub: 'unit-user',
		iat: fixedNow / 1000,
		exp: fixedNow / 1000 + 300,
		...claims,
	})
		.setProtectedHeader({ alg: 'RS256', kid: 'server-unit-key' })
		.sign(privateKey)
}

export const requestFor = async (path: string, token?: string) =>
	new Request(`https://reader.example${path}`, {
		headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {},
	})

const originalFetch = globalThis.fetch

export const setupJwks = async () => {
	const { jwk } = await keyFixture
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = input instanceof Request ? input.url : input.toString()
		if (url !== `${issuer}/cdn-cgi/access/certs`)
			throw new Error(`Unexpected network request: ${url}`)
		return new Response(JSON.stringify({ keys: [jwk] }))
	}) as typeof fetch
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(fixedNow)
}

export const resetJwks = () => {
	globalThis.fetch = originalFetch
	vi.useRealTimers()
}

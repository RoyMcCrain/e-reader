import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { checkAccess } from '#server/access.ts'
import {
	accessEnv,
	fixedNow,
	requestFor,
	resetJwks,
	setupJwks,
	tokenFor,
} from '#server/test-helpers.ts'

describe('checkAccess', () => {
	beforeEach(setupJwks)
	afterEach(resetJwks)

	test('fails closed for missing configuration and absent or malformed credentials', async () => {
		expect(await checkAccess(await requestFor('/'), accessEnv())).toBe(401)
		expect(
			await checkAccess(await requestFor('/', 'not.a.jwt'), accessEnv()),
		).toBe(401)
		const token = await tokenFor()
		for (const settings of [
			{ ACCESS_TEAM_DOMAIN: '' },
			{ ACCESS_AUD: '' },
			{ ACCESS_ALLOWED_EMAIL: '' },
		]) {
			expect(
				await checkAccess(await requestFor('/', token), accessEnv(settings)),
			).toBe(503)
		}
	})

	test('requires the configured issuer, audience, signature, and exact owner identity', async () => {
		const valid = await tokenFor()
		expect(await checkAccess(await requestFor('/', valid), accessEnv())).toBe(
			200,
		)
		for (const claims of [
			{ iss: 'https://foreign.cloudflareaccess.com' },
			{ aud: 'foreign-audience' },
			{ email: 'other@example.com' },
		]) {
			const token = await tokenFor(claims)
			expect(await checkAccess(await requestFor('/', token), accessEnv())).toBe(
				claims.email ? 403 : 401,
			)
		}
		const [header, payload, signature] = valid.split('.')
		const tampered = `${header}.${payload}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`
		expect(
			await checkAccess(await requestFor('/', tampered), accessEnv()),
		).toBe(401)
	})

	test('requires valid bounded claims and permits documented boundaries', async () => {
		const now = fixedNow / 1000
		for (const claims of [
			{ exp: now },
			{ iat: now + 61 },
			{ exp: now + 86_401 },
			{ sub: 42 },
			{ iat: undefined },
		]) {
			expect(
				await checkAccess(
					await requestFor('/', await tokenFor(claims)),
					accessEnv(),
				),
			).toBe(401)
		}
		for (const claims of [
			{ iat: now + 60 },
			{ iat: now - 1, exp: now + 86_399 },
		]) {
			expect(
				await checkAccess(
					await requestFor('/', await tokenFor(claims)),
					accessEnv(),
				),
			).toBe(200)
		}
	})

	test('rejects team hostnames outside the Access domain format', async () => {
		const token = await tokenFor()
		for (const team of [
			'attacker reader-unit.cloudflareaccess.com',
			'reader-unit.cloudflareaccess.com.attacker.test',
		]) {
			expect(
				await checkAccess(
					await requestFor('/', token),
					accessEnv({ ACCESS_TEAM_DOMAIN: team }),
				),
			).toBe(503)
		}
	})
})

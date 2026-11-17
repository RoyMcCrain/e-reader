import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessEnv {
	ACCESS_TEAM_DOMAIN?: string
	ACCESS_AUD?: string
	ACCESS_ALLOWED_EMAIL?: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
const accessHeader = 'Cf-Access-Jwt-Assertion'

const getKeySet = (issuer: string) => {
	const existing = keySets.get(issuer)
	if (existing) return existing
	const keySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
	keySets.set(issuer, keySet)
	return keySet
}

const accessSettings = (env: AccessEnv) => {
	const {
		ACCESS_TEAM_DOMAIN: team,
		ACCESS_AUD: audience,
		ACCESS_ALLOWED_EMAIL: email,
	} = env
	if (
		!team ||
		!audience ||
		!email ||
		!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(team)
	)
		return null
	return { issuer: `https://${team}`, audience, email }
}

const validClaims = (
	payload: Awaited<ReturnType<typeof jwtVerify>>['payload'],
) => {
	const now = Math.floor(Date.now() / 1000)
	return (
		typeof payload.exp === 'number' &&
		typeof payload.iat === 'number' &&
		typeof payload.sub === 'string' &&
		payload.iat <= now + 60 &&
		payload.exp > now &&
		payload.exp - payload.iat <= 86_400
	)
}

export const verifiedSubject = async (request: Request, env: AccessEnv) => {
	const settings = accessSettings(env)
	if (!settings) return { status: 503 as const }
	const token = request.headers.get(accessHeader)
	if (!token) return { status: 401 as const }
	try {
		const { payload } = await jwtVerify(token, getKeySet(settings.issuer), {
			issuer: settings.issuer,
			audience: settings.audience,
			algorithms: ['RS256'],
		})
		if (!validClaims(payload)) return { status: 401 as const }
		if (payload.email !== settings.email) return { status: 403 as const }
		return { status: 200 as const, subject: payload.sub as string }
	} catch {
		return { status: 401 as const }
	}
}

export const checkAccess = async (request: Request, env: AccessEnv) =>
	(await verifiedSubject(request, env)).status

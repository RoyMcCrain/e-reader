import { verifiedSubject, type AccessEnv } from '#server/access.ts'

interface PositionEnv extends AccessEnv {
	DB?: import('@cloudflare/workers-types').D1Database
}

interface Position {
	cfi: string
	revision: number
	mutationId: string
}

interface Mutation {
	cfi: string
	baseRevision: number
	mutationId: string
}

const headers = {
	'Cache-Control': 'private, no-store',
	'X-Content-Type-Options': 'nosniff',
}

const reply = (
	body: unknown,
	status = 200,
	extraHeaders: Record<string, string> = {},
) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			...headers,
			'Content-Type': 'application/json; charset=utf-8',
			...extraHeaders,
		},
	})

const validCfi = (value: unknown): value is string =>
	typeof value === 'string' &&
	value.length <= 4096 &&
	/^epubcfi\(.+\)$/u.test(value)

const validBookId = (value: string) => /^[a-f0-9]{64}$/u.test(value)

const validMutationId = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
		value,
	)

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value)

const validateMutation = (value: unknown): Mutation | null => {
	if (!isRecord(value)) return null
	const { cfi, baseRevision, mutationId } = value
	if (
		!validCfi(cfi) ||
		!validMutationId(mutationId) ||
		typeof baseRevision !== 'number' ||
		!Number.isSafeInteger(baseRevision) ||
		baseRevision < 0 ||
		baseRevision >= Number.MAX_SAFE_INTEGER
	)
		return null
	return { cfi, baseRevision, mutationId }
}

const readBody = async (
	request: Request,
): Promise<string | null | undefined> => {
	const reader = request.body?.getReader()
	if (!reader) return null
	const chunks: Uint8Array[] = []
	let size = 0
	while (true) {
		const { done, value } = await reader.read()
		if (done) break
		size += value.byteLength
		if (size > 32 * 1024) {
			await reader.cancel()
			return undefined
		}
		chunks.push(value)
	}
	const bytes = new Uint8Array(size)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return new TextDecoder().decode(bytes)
}

const parseMutation = async (request: Request) => {
	const raw = await readBody(request)
	if (raw === undefined) return { status: 413 as const }
	if (!raw) return { status: 400 as const }
	try {
		const body: unknown = JSON.parse(raw)
		const input = validateMutation(body)
		return input ? { input } : { status: 400 as const }
	} catch {
		return { status: 400 as const }
	}
}

const selectPosition = (env: PositionEnv, userId: string, bookId: string) =>
	env
		.DB!.prepare(
			'SELECT cfi, revision, mutation_id AS mutationId FROM reading_positions WHERE user_id = ? AND book_id = ?',
		)
		.bind(userId, bookId)
		.first<Position>()

const writeMutation = async (
	env: PositionEnv,
	userId: string,
	bookId: string,
	input: Mutation,
) =>
	env
		.DB!.prepare(
			`
  INSERT INTO reading_positions (user_id, book_id, cfi, revision, mutation_id)
  SELECT ?, ?, ?, 1, ?
  WHERE ? = 0 OR EXISTS (
    SELECT 1 FROM reading_positions WHERE user_id = ? AND book_id = ?
  )
  ON CONFLICT(user_id, book_id) DO UPDATE SET
    cfi = excluded.cfi,
    revision = reading_positions.revision + 1,
    mutation_id = excluded.mutation_id
  WHERE reading_positions.revision = ?
    AND reading_positions.mutation_id != excluded.mutation_id
`,
		)
		.bind(
			userId,
			bookId,
			input.cfi,
			input.mutationId,
			input.baseRevision,
			userId,
			bookId,
			input.baseRevision,
		)
		.run()

const replayResult = (current: Position | null, input: Mutation) => {
	if (current?.mutationId !== input.mutationId) return null
	return current.cfi === input.cfi
		? reply({ position: current })
		: reply({ position: current }, 409)
}

const commitMutation = async (
	env: PositionEnv,
	userId: string,
	bookId: string,
	input: Mutation,
) => {
	const current = await selectPosition(env, userId, bookId)
	const replay = replayResult(current, input)
	if (replay) return replay

	const result = await writeMutation(env, userId, bookId, input)
	if (result.meta.changes > 0) {
		return reply({
			position: {
				cfi: input.cfi,
				revision: input.baseRevision + 1,
				mutationId: input.mutationId,
			},
		})
	}

	const latest = await selectPosition(env, userId, bookId)
	const concurrentReplay = replayResult(latest, input)
	return concurrentReplay ?? reply({ position: latest ?? null }, 409)
}

const putPosition = async (
	request: Request,
	env: PositionEnv,
	userId: string,
	bookId: string,
) => {
	if (request.headers.get('Origin') !== new URL(request.url).origin)
		return reply({ error: 'invalid origin' }, 403)
	const contentType = request.headers
		.get('Content-Type')
		?.split(';', 1)[0]
		?.trim()
		.toLowerCase()
	if (contentType !== 'application/json')
		return reply({ error: 'json required' }, 415)
	const parsed = await parseMutation(request)
	if ('status' in parsed)
		return reply({ error: 'invalid payload' }, parsed.status)
	return commitMutation(env, userId, bookId, parsed.input)
}

export const handleReadingPosition = async (
	request: Request,
	env: PositionEnv,
	bookId: string,
) => {
	const auth = await verifiedSubject(request, env)
	if (auth.status !== 200) return reply({ error: 'unauthorized' }, auth.status)
	if (!validBookId(bookId)) return reply({ error: 'invalid book id' }, 400)
	if (!env.DB) return reply({ error: 'database unavailable' }, 503)
	try {
		if (request.method === 'GET')
			return reply({
				position: (await selectPosition(env, auth.subject, bookId)) ?? null,
			})
		if (request.method !== 'PUT')
			return reply({ error: 'method not allowed' }, 405, { Allow: 'GET, PUT' })
		return await putPosition(request, env, auth.subject, bookId)
	} catch {
		return reply({ error: 'database unavailable' }, 503)
	}
}

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const workflow = Bun.YAML.parse(
	await readFile(
		new URL('../../.github/workflows/ci-cd.yml', import.meta.url),
		'utf8',
	),
) as {
	env?: Record<string, string>
	jobs: {
		deploy: {
			steps: { env?: Record<string, string>; name?: string; run?: string }[]
		}
		validate: {
			env?: Record<string, string>
			steps: { env?: Record<string, string>; name?: string; run?: string }[]
		}
	}
}
const runScript = workflow.jobs.deploy.steps.find(
	({ env }) => env?.CF_ACCESS_READINESS_ORIGIN,
)?.run
assert.ok(runScript)

const runScriptWithStub = async (
	script: string,
	credentials: Record<string, string | undefined>,
	commandStatus = 0,
) => {
	const directory = await mkdtemp(join(tmpdir(), 'e-reader-deploy-'))
	const bin = join(directory, 'bin')
	const log = join(directory, 'calls')
	await mkdir(bin)
	await mkdir(join(directory, 'src/deploy'), { recursive: true })
	await copyFile(
		new URL('./deploy.sh', import.meta.url),
		join(directory, 'src/deploy/deploy.sh'),
	)
	await writeFile(
		join(bin, 'bunx'),
		`#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "$DEPLOY_CALLS"\nexit "${commandStatus}"\n`,
		{ mode: 0o755 },
	)
	await writeFile(
		join(bin, 'curl'),
		'#!/usr/bin/env bash\necho "unexpected private API probe" >&2\nexit 99\n',
		{ mode: 0o755 },
	)
	try {
		const result = spawnSync('bash', ['-c', script], {
			cwd: directory,
			encoding: 'utf8',
			env: {
				...credentials,
				PATH: `${bin}:${process.env.PATH}`,
				DEPLOY_CALLS: log,
			},
		})
		return { ...result, calls: await readFile(log, 'utf8').catch(() => '') }
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

void test('validates committed migrations locally without cloud credentials', async () => {
	const migrationStep = workflow.jobs.validate.steps.find(
		({ name }) => name === 'Validate local database migrations',
	)
	assert.ok(migrationStep?.run, 'Missing required migration step')
	for (const name of [
		'CLOUDFLARE_API_TOKEN',
		'CF_ACCESS_CLIENT_ID',
		'CF_ACCESS_CLIENT_SECRET',
	]) {
		assert.equal(workflow.env?.[name], undefined, name)
		assert.equal(workflow.jobs.validate.env?.[name], undefined, name)
		assert.equal(migrationStep.env?.[name], undefined, name)
	}

	const result = await runScriptWithStub(migrationStep.run, {})
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.calls, '--no-install void db migrate\n')

	const failed = await runScriptWithStub(migrationStep.run, {}, 23)
	assert.equal(failed.status, 23)
	assert.equal(failed.calls, '--no-install void db migrate\n')
})

void test('deploys using service credentials without a human token', async () => {
	const result = await runScriptWithStub(runScript, {
		CLOUDFLARE_API_TOKEN: 'management-token',
		CF_ACCESS_CLIENT_ID: 'service-id',
		CF_ACCESS_CLIENT_SECRET: 'service-secret',
		CF_ACCESS_READINESS_ORIGIN: 'https://reader.rrrr.dev',
	})
	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.calls, '--no-install void deploy --platform cloudflare\n')
})

void test('missing required credentials fail before deployment, even with old token', async () => {
	for (const missing of [
		'CLOUDFLARE_API_TOKEN',
		'CF_ACCESS_CLIENT_ID',
		'CF_ACCESS_CLIENT_SECRET',
	]) {
		const credentials = {
			CLOUDFLARE_API_TOKEN: 'management-token',
			CF_ACCESS_CLIENT_ID: 'service-id',
			CF_ACCESS_CLIENT_SECRET: 'service-secret',
			CF_ACCESS_TOKEN: 'old-human-token',
			CF_ACCESS_READINESS_ORIGIN: 'https://reader.rrrr.dev',
		}
		delete credentials[missing as keyof typeof credentials]
		const result = await runScriptWithStub(runScript, credentials)
		assert.notEqual(result.status, 0, missing)
		assert.equal(result.calls, '', missing)
		assert.match(result.stderr, new RegExp(missing), missing)
	}
})

void test('propagates deployment failure', async () => {
	const result = await runScriptWithStub(
		runScript,
		{
			CLOUDFLARE_API_TOKEN: 'management-token',
			CF_ACCESS_CLIENT_ID: 'service-id',
			CF_ACCESS_CLIENT_SECRET: 'service-secret',
			CF_ACCESS_READINESS_ORIGIN: 'https://reader.rrrr.dev',
		},
		23,
	)
	assert.equal(result.status, 23)
	assert.equal(result.calls, '--no-install void deploy --platform cloudflare\n')
})

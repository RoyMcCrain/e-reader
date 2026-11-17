type D1Database = import('@cloudflare/workers-types').D1Database
type R2Bucket = import('@cloudflare/workers-types').R2Bucket

declare module 'cloudflare:workers' {
	export const env: import('#server/library').LibraryEnv &
		Pick<import('void').CloudBindings, 'DB'>
}

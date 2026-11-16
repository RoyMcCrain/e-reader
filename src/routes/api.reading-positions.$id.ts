import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { handleReadingPosition } from '#server/reading-positions'

export const Route = createFileRoute('/api/reading-positions/$id')({
	server: {
		handlers: {
			ANY: ({ request, params }) =>
				handleReadingPosition(request, env, params.id),
		},
	},
})

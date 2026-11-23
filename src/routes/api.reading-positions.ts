import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

import { handleReadingPositions } from '#server/reading-positions'

export const Route = createFileRoute('/api/reading-positions')({
	server: {
		handlers: {
			ANY: ({ request }) => handleReadingPositions(request, env),
		},
	},
})

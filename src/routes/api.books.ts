import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { handleLibrary } from '../server/library'

export const Route = createFileRoute('/api/books')({
  server: {
    handlers: {
      ANY: ({ request }) => handleLibrary(request, env),
    },
  },
})

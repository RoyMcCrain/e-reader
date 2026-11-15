import { defineConfig } from 'void/config'

export default defineConfig({
  target: 'cloudflare',
  cloudflare: {
    name: 'e-reader',
    account_id: '8da37f2c68005226e55dffb2ffc7664b',
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: 'reader.rrrr.dev', custom_domain: true }],
    r2_buckets: [{ binding: 'BOOKS', bucket_name: 'e-reader-books' }],
  },
  inference: { bindings: { storage: 'BOOKS' } },
  worker: {
    compatibility_date: '2026-11-14',
    compatibility_flags: ['nodejs_compat'],
    vars: {
      ACCESS_TEAM_DOMAIN: 'blog-ao0-pages.cloudflareaccess.com',
      ACCESS_AUD:
        '943508cde46e7c9ea10fa8a59b94daa182009b2c0e50a741a2fd55b0d12233b9',
      ACCESS_ALLOWED_EMAIL: 'me@rrrr.dev',
    },
  },
})

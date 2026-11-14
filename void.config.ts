import { defineConfig } from 'void/config'

export default defineConfig({
  target: 'cloudflare',
  cloudflare: { name: 'e-reader' },
  worker: {
    compatibility_date: '2026-11-14',
    compatibility_flags: ['nodejs_compat'],
  },
})

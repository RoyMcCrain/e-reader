import { env } from 'node:process'

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
	testDir: './e2e',
	testMatch: '**/*.e2e.ts',
	use: { baseURL: 'http://127.0.0.1:5173' },
	webServer: {
		command: 'bun run dev --host 127.0.0.1',
		port: 5173,
		reuseExistingServer: !env.CI,
		timeout: 60_000,
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
})

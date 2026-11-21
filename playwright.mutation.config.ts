import { defineConfig } from '@playwright/test'

import baseConfig from './playwright.config'

export default defineConfig({
	...baseConfig,
	testMatch: 'bookshelf.e2e.ts',
	outputDir: '.mutator/playwright-results',
	use: { ...baseConfig.use, baseURL: 'http://127.0.0.1:5187' },
	webServer: {
		command: 'vp dev --host 127.0.0.1 --port 5187 --strictPort',
		url: 'http://127.0.0.1:5187',
		reuseExistingServer: false,
		timeout: 90_000,
	},
})

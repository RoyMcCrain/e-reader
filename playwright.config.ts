import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: '**/*.e2e.ts',
	use: { baseURL: 'http://127.0.0.1:5173' },
	webServer: {
		command: 'bun run dev --host 127.0.0.1',
		port: 5173,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
	},
	projects: [
		{
			name: 'chromium',
			grepInvert: /@native/,
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'mobile',
			grepInvert: /@native/,
			use: { ...devices['Pixel 7'] },
		},
		{
			name: 'native',
			grep: /@native(?!-scale)|@lazy-native|fixed-layout EPUB|EPUB (ltr|rtl) (skips|presents)/,
			use: {
				browserName: 'chromium',
				viewport: null,
				launchOptions: {
					args: ['--window-size=1495,1188', '--force-device-scale-factor=1.5'],
				},
			},
		},
		...[
			['1', '1'],
			['125', '1.25'],
			['15', '1.5'],
			['175', '1.75'],
			['2625', '2.625'],
		].map(([tag, scale]) => ({
			name: `native-${tag}`,
			grep: new RegExp(`@native-scale-${tag}$`),
			use: {
				browserName: 'chromium' as const,
				viewport: null,
				launchOptions: {
					args: [
						'--window-size=1495,1188',
						`--force-device-scale-factor=${scale}`,
					],
				},
			},
		})),
	],
})

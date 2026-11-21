import { defineConfig } from 'vite-plus'

export default defineConfig({
	envDir: false,
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		environment: 'node',
		// Mutator changes the source transform when the mutation scope changes.
		fsModuleCache: false,
		include: ['src/**/*.test.ts'],
		exclude: [
			'**/node_modules/**',
			'src/server/library-r2.test.ts',
			'src/server/reading-positions-d1.test.ts',
		],
	},
})

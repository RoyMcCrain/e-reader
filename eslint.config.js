import tseslint from 'typescript-eslint'
export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: [
      'src/routeTree.gen.ts',
      '.void/**',
      'node_modules/**',
      '.cloudflare/**',
      'dist/**',
      'test-results/**',
    ],
  },
  { rules: { '@typescript-eslint/no-explicit-any': 'off' } },
)

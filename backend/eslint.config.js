import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'src/generated']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // `_`-prefixed names are intentionally unused (destructure omits, etc.).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Test mocks/stubs legitimately use `any` to fake Prisma/Graph shapes.
    files: ['**/*.test.ts', 'src/test-harness.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])

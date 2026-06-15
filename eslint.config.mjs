import js from '@eslint/js'
import {defineConfig, globalIgnores} from 'eslint/config'
import tseslint from 'typescript-eslint'

const globals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Blob: 'readonly',
  Bun: 'readonly',
  Buffer: 'readonly',
  FormData: 'readonly',
  Headers: 'readonly',
  ReadableStream: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  afterEach: 'readonly',
  beforeEach: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  describe: 'readonly',
  fetch: 'readonly',
  it: 'readonly',
  process: 'readonly',
  setTimeout: 'readonly',
}

export default defineConfig([
  globalIgnores([
    '**/.DS_Store',
    '**/*-debug.log',
    '**/*-error.log',
    '.bun/**',
    '.idea/**',
    '.video-agent/**',
    'dist/**',
    'node_modules/**',
    'packages/*/dist/**',
    'packages/*/node_modules/**',
    'packages/*/tsconfig.tsbuildinfo',
    'tmp/**',
    'tsconfig.tsbuildinfo',
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals,
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', {fixStyle: 'inline-type-imports'}],
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_'}],
      'complexity': ['error', 28],
      'no-await-in-loop': 'error',
    },
  },
])

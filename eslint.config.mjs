import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import {globalIgnores} from 'eslint/config'

export default [
  globalIgnores([
    '**/.DS_Store',
    '**/*-debug.log',
    '**/*-error.log',
    '.bun/**',
    '.idea/**',
    '.video-agent/**',
    'dist/**',
    'node_modules/**',
    'oclif.manifest.json',
    'packages/*/dist/**',
    'packages/*/node_modules/**',
    'packages/*/tsconfig.tsbuildinfo',
    'tmp/**',
    'tsconfig.tsbuildinfo',
  ]),
  ...oclif,
  prettier,
]

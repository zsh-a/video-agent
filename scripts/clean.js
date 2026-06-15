#!/usr/bin/env bun

import {Glob} from 'bun'
import {rm} from 'node:fs/promises'

const paths = new Set(['dist', 'tsconfig.tsbuildinfo'])
const matches = await Promise.all(
  ['packages/*/dist', 'packages/*/*.tsbuildinfo'].map((pattern) => Array.fromAsync(new Glob(pattern).scan({cwd: Bun.cwd, onlyFiles: false}))),
)

for (const path of matches.flat()) {
  paths.add(path)
}

await Promise.all([...paths].map((path) => rm(path, {force: true, recursive: true})))

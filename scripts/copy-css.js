#!/usr/bin/env bun

import {Glob} from 'bun'
import {cp, mkdir} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

const cwd = Bun.cwd

for await (const srcPath of new Glob('packages/*/src/**/*.css').scan({cwd})) {
  const distPath = srcPath.replace('/src/', '/dist/')
  await mkdir(dirname(resolve(cwd, distPath)), {recursive: true})
  await cp(resolve(cwd, srcPath), resolve(cwd, distPath))
}

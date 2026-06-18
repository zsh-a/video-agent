import type {Deck} from '@video-agent/ir'

import {runProcess} from '@video-agent/media'
import {createRequire} from 'node:module'
import {dirname, resolve} from 'node:path'

import {bunWrite} from '../bun-runtime.js'
import {createDeckThemeCss} from './themes/create-theme-css.js'

const require = createRequire(import.meta.url)

export interface CompileDeckTailwindCssOptions {
  deck: Deck
  inputPath: string
  outputPath: string
  sourceHtmlPath: string
}

export class DeckTailwindCompileError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export async function compileDeckTailwindCss(options: CompileDeckTailwindCssOptions): Promise<void> {
  await bunWrite(options.inputPath, createDeckThemeCss(options.deck, {
    sourceHtmlPath: options.sourceHtmlPath,
    tailwindCssPath: resolveTailwindCssPath(),
  }))

  const command = [
    process.execPath,
    resolveTailwindCliPath(),
    '-i',
    options.inputPath,
    '-o',
    options.outputPath,
    '--silent',
  ]
  const result = await runProcess(command)

  if (result.code !== 0) {
    throw new DeckTailwindCompileError(`Tailwind CSS failed with exit code ${result.code}`, command, result.stderr)
  }
}

function resolveTailwindCssPath(): string {
  return require.resolve('tailwindcss/index.css')
}

function resolveTailwindCliPath(): string {
  return resolve(dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs')
}

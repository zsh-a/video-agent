import type {Deck} from '@video-agent/ir'

import {runProcess} from '@video-agent/media'
import {createHash} from 'node:crypto'
import {copyFile, mkdir} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, resolve} from 'node:path'

import {bunWrite} from '../bun-runtime.js'
import {createDeckCss} from './styles/create-deck-css.js'

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
  const cachePath = resolveDeckTailwindCachePath(options.deck)

  if (await copyCachedCss(cachePath, options.outputPath)) {
    await bunWrite(options.inputPath, createDeckCss(options.deck, {
      sourceHtmlPath: options.sourceHtmlPath,
      tailwindCssPath: resolveTailwindCssPath(),
    }))
    return
  }

  await bunWrite(options.inputPath, createDeckCss(options.deck, {
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

  await writeCachedCss(options.outputPath, cachePath)
}

async function copyCachedCss(cachePath: string, outputPath: string): Promise<boolean> {
  try {
    await mkdir(dirname(outputPath), {recursive: true})
    await copyFile(cachePath, outputPath)

    return true
  } catch {
    return false
  }
}

async function writeCachedCss(outputPath: string, cachePath: string): Promise<void> {
  try {
    await mkdir(dirname(cachePath), {recursive: true})
    await copyFile(outputPath, cachePath)
  } catch {
    // Cache writes are best-effort; rendering should not fail if the cache is unavailable.
  }
}

function resolveDeckTailwindCachePath(deck: Deck): string {
  const key = createHash('sha256')
    .update(JSON.stringify({
      format: deck.format,
      language: deck.language,
      slideTypes: Array.from(new Set(deck.slides.map((slide) => slide.type))).sort(),
      theme: deck.theme,
      themeTokens: deck.theme === 'custom' ? deck.themeTokens ?? {} : {},
      version: 1,
    }))
    .digest('hex')

  return resolve(tmpdir(), 'video-agent-deck-tailwind-cache', `${key}.css`)
}

function resolveTailwindCssPath(): string {
  return require.resolve('tailwindcss/index.css')
}

function resolveTailwindCliPath(): string {
  return resolve(dirname(require.resolve('@tailwindcss/cli/package.json')), 'dist/index.mjs')
}

import type {RemotionDeckProject} from './compiler.js'

import {bundle} from '@remotion/bundler'
import {getCompositions, renderMedia} from '@remotion/renderer'
import {runProcess} from '@video-agent/media'
import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'

export interface RemotionRenderCliOptions {
  command?: string[]
  outputPath?: string
  projectDir: string
}

export interface RemotionRenderCliResult {
  command: string[]
  outputPath: string
  stderr: string
  stdout: string
}

export interface RemotionRenderMediaProgress {
  encodedDoneIn: number | null
  encodedFrames: number
  progress: number
  renderEstimatedTime: number
  renderedDoneIn: number | null
  renderedFrames: number
  stitchStage: 'encoding' | 'muxing'
}

export type RemotionRenderMediaCodec = 'h264'
export type RemotionRenderMediaImageFormat = 'jpeg' | 'png'
export type RemotionRenderMediaX264Preset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow' | 'placebo'

export interface RemotionRenderMediaOptions {
  codec?: RemotionRenderMediaCodec
  concurrency?: number | string
  imageFormat?: RemotionRenderMediaImageFormat
  jpegQuality?: number
  onProgress?: (progress: RemotionRenderMediaProgress) => void
  outputPath?: string
  project: RemotionDeckProject
  x264Preset?: RemotionRenderMediaX264Preset
}

export interface RemotionRenderMediaResult {
  codec: RemotionRenderMediaCodec
  compositionId: string
  concurrency: number | string
  imageFormat: RemotionRenderMediaImageFormat
  jpegQuality: number
  outputPath: string
  slowestFrames: Array<{frame: number; time: number}>
  x264Preset: RemotionRenderMediaX264Preset
}

export class RemotionRenderCliError extends Error {
  constructor(
    message: string,
    readonly command: string[],
    readonly stderr: string,
  ) {
    super(message)
  }
}

export function buildRemotionRenderArgs(options: Pick<RemotionRenderCliOptions, 'command'>): string[] {
  return options.command ?? ['bun', 'run', 'render']
}

export async function renderRemotionDeckProject(options: RemotionRenderCliOptions): Promise<RemotionRenderCliResult> {
  const projectDir = resolve(options.projectDir)
  const outputPath = resolve(options.outputPath ?? resolve(projectDir, 'out', 'final.mp4'))
  const command = buildRemotionRenderArgs(options)
  const result = await runProcess(command, {cwd: projectDir})

  if (result.code !== 0) {
    throw new RemotionRenderCliError(`Remotion command failed with exit code ${result.code}`, command, result.stderr)
  }

  const output = await stat(outputPath)

  if (output.size <= 0) {
    throw new RemotionRenderCliError(`Remotion output is empty: ${outputPath}`, command, result.stderr)
  }

  return {
    command,
    outputPath,
    stderr: result.stderr,
    stdout: result.stdout,
  }
}

export async function renderRemotionDeckMedia(options: RemotionRenderMediaOptions): Promise<RemotionRenderMediaResult> {
  const projectDir = resolve(options.project.outputDir)
  const outputPath = resolve(options.outputPath ?? resolve(projectDir, 'out', 'final.mp4'))
  const codec = options.codec ?? 'h264'
  const concurrency = options.concurrency ?? '75%'
  const imageFormat = options.imageFormat ?? 'jpeg'
  const jpegQuality = normalizeRemotionJpegQuality(options.jpegQuality)
  const x264Preset = options.x264Preset ?? 'veryfast'
  const serveUrl = await bundle({
    entryPoint: options.project.entryPath,
  })
  const compositions = await getCompositions(serveUrl)
  const composition = compositions.find((item) => item.id === options.project.compositionId)

  if (composition === undefined) {
    throw new RemotionRenderCliError(`Remotion composition not found: ${options.project.compositionId}`, ['renderMedia'], '')
  }

  const rendered = await renderMedia({
    codec,
    composition,
    concurrency,
    imageFormat,
    jpegQuality,
    muted: true,
    onProgress: options.onProgress,
    outputLocation: outputPath,
    overwrite: true,
    serveUrl,
    x264Preset,
  })
  const output = await stat(outputPath)

  if (output.size <= 0) {
    throw new RemotionRenderCliError(`Remotion output is empty: ${outputPath}`, ['renderMedia'], '')
  }

  return {
    codec,
    compositionId: options.project.compositionId,
    concurrency,
    imageFormat,
    jpegQuality,
    outputPath,
    slowestFrames: rendered.slowestFrames,
    x264Preset,
  }
}

export function normalizeRemotionJpegQuality(value: number | undefined): number {
  if (value === undefined) {
    return 85
  }

  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`Remotion Deck jpegQuality must be an integer between 0 and 100; no render option clamp or coercion is allowed. Received: ${String(value)}`)
  }

  return value
}

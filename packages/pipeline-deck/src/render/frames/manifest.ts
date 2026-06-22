import type {DeckHtmlCaptureBackend, TimedDeck} from '@video-agent/ir'
import type {CaptureDeckHtmlFrameSequenceResult, DeckHtmlFrameSequenceFrame} from '@video-agent/renderer-html'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {DECK_HTML_CAPTURE_BACKENDS} from '@video-agent/ir'
import {deckCanvasSize} from '@video-agent/renderer-deck'
import {createDeckHtmlFrameSequence} from '@video-agent/renderer-html'
import {DECK_FRAME_MANIFEST_ARTIFACT_NAME, TIMED_DECK_ARTIFACT_NAME} from '@video-agent/runtime'
import {resolve} from 'node:path'
import {z} from 'zod'

import {resolveProjectPath, toProjectPath} from '../../project/paths.js'
import {roundSeconds} from '../../shared/utils.js'

const DeckFrameManifestReuseSchema = z.object({
  capturedFrames: z.number().int().nonnegative().optional(),
  concurrency: z.number().int().positive().optional(),
  duration: z.number().nonnegative(),
  fps: z.number().positive(),
  frameCount: z.number().int().positive(),
  frameEnd: z.number().int().positive().optional(),
  frames: z.array(z.object({
    frame: z.number().int().positive(),
    path: z.string().min(1),
    slideId: z.string().min(1),
    time: z.number().nonnegative(),
  }).strict()),
  frameStart: z.number().int().positive().optional(),
  outputDir: z.string().min(1),
  pattern: z.string().min(1),
  renderer: z.enum(DECK_HTML_CAPTURE_BACKENDS),
  skippedFrames: z.number().int().nonnegative().optional(),
  sourceSha256: z.string().min(1),
  viewport: z.object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  }).strict(),
}).passthrough()

type ReusableDeckFrameManifest = z.infer<typeof DeckFrameManifestReuseSchema>

export async function readReusableDeckFrameManifest(workspace: ProjectWorkspace, expected: {
  fps: number
  outputDir: string
  renderer?: DeckHtmlCaptureBackend
  sourceSha256: string
}): Promise<ReusableDeckFrameManifest | undefined> {
  const value = await readDeckFrameManifestArtifact(workspace)

  if (value === undefined) {
    return undefined
  }

  const manifest = DeckFrameManifestReuseSchema.parse(value)
  const matches = manifest.fps === expected.fps
    && manifest.outputDir === toProjectPath(workspace.projectDir, expected.outputDir)
    && (expected.renderer === undefined || manifest.renderer === expected.renderer)
    && manifest.sourceSha256 === expected.sourceSha256

  return matches ? manifest : undefined
}

async function readDeckFrameManifestArtifact(workspace: ProjectWorkspace): Promise<unknown | undefined> {
  try {
    return await workspace.store.readJson(DECK_FRAME_MANIFEST_ARTIFACT_NAME)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

export function resolveDeckFinalizeOnlyManifest(input: {
  finalizeOnly: boolean
  requestedFrameRange: {end?: number; start?: number} | undefined
  reusableFrameManifest: ReusableDeckFrameManifest | undefined
}): ReusableDeckFrameManifest | undefined {
  if (!input.finalizeOnly) {
    return undefined
  }

  if (input.requestedFrameRange !== undefined) {
    throw new TypeError('finalizeOnly cannot be combined with frameStart/frameEnd; capture shards first, then finalize from the complete frame manifest.')
  }

  if (input.reusableFrameManifest === undefined) {
    throw new Error('Cannot finalize Deck video from existing frames because artifacts/deck-frame-manifest.json is missing or does not match timed-deck.json.')
  }

  return input.reusableFrameManifest
}

export function createDeckFrameCaptureFromManifest(input: {
  concurrency: number
  manifest: ReusableDeckFrameManifest
  projectDir: string
}): CaptureDeckHtmlFrameSequenceResult {
  return {
    backend: input.manifest.renderer,
    capturedFrames: 0,
    command: [],
    concurrency: input.concurrency,
    duration: input.manifest.duration,
    fps: input.manifest.fps,
    frameEnd: input.manifest.frameCount,
    frameStart: 1,
    frames: input.manifest.frames.map((frame) => ({
      frame: frame.frame,
      path: resolveProjectPath(input.projectDir, frame.path),
      slideId: frame.slideId,
      time: frame.time,
    })),
    outputDir: resolveProjectPath(input.projectDir, input.manifest.outputDir),
    pattern: resolveProjectPath(input.projectDir, input.manifest.pattern),
    skippedFrames: input.manifest.frameCount,
    viewport: input.manifest.viewport,
  }
}

export function createPlannedDeckFrameManifest(input: {
  concurrency: number
  fps: number
  outputDir: string
  projectDir: string
  renderer: DeckHtmlCaptureBackend
  sourceSha256: string
  timedDeck: TimedDeck
}) {
  const frames = createDeckHtmlFrameSequence({
    fps: input.fps,
    outputDir: input.outputDir,
    timedDeck: input.timedDeck,
  })

  return {
    concurrency: input.concurrency,
    duration: roundSeconds(frames.length / input.fps),
    fps: input.fps,
    frameCount: frames.length,
    frames: frames.map((frame) => ({
      frame: frame.frame,
      path: toProjectPath(input.projectDir, frame.path),
      slideId: frame.slideId,
      time: frame.time,
    })),
    generatedAt: new Date().toISOString(),
    outputDir: toProjectPath(input.projectDir, input.outputDir),
    pattern: toProjectPath(input.projectDir, resolve(input.outputDir, 'frame-%06d.png')),
    renderer: input.renderer,
    source: TIMED_DECK_ARTIFACT_NAME,
    sourceSha256: input.sourceSha256,
    version: 1 as const,
    viewport: deckCanvasSize(input.timedDeck.deck.format),
  }
}

export function createDeckFrameManifest(input: {
  frameCapture: CaptureDeckHtmlFrameSequenceResult
  projectDir: string
  sourceSha256: string
}) {
  return {
    capturedFrames: input.frameCapture.capturedFrames,
    concurrency: input.frameCapture.concurrency,
    duration: input.frameCapture.duration,
    fps: input.frameCapture.fps,
    frameCount: input.frameCapture.frames.length,
    frameEnd: input.frameCapture.frameEnd,
    frameStart: input.frameCapture.frameStart,
    frames: input.frameCapture.frames.map((frame) => ({
      frame: frame.frame,
      path: toProjectPath(input.projectDir, frame.path),
      slideId: frame.slideId,
      time: frame.time,
    })),
    generatedAt: new Date().toISOString(),
    outputDir: toProjectPath(input.projectDir, input.frameCapture.outputDir),
    pattern: toProjectPath(input.projectDir, input.frameCapture.pattern),
    renderer: input.frameCapture.backend,
    skippedFrames: input.frameCapture.skippedFrames,
    source: TIMED_DECK_ARTIFACT_NAME,
    sourceSha256: input.sourceSha256,
    version: 1 as const,
    viewport: input.frameCapture.viewport,
  }
}

export function createDeckFrameCaptureFromFrames(input: {
  backend: DeckHtmlCaptureBackend
  capturedFrames: number
  concurrency: number
  fps: number
  frames: DeckHtmlFrameSequenceFrame[]
  outputDir: string
  skippedFrames: number
  timedDeck: TimedDeck
}): CaptureDeckHtmlFrameSequenceResult {
  return {
    backend: input.backend,
    capturedFrames: input.capturedFrames,
    command: [],
    concurrency: input.concurrency,
    duration: roundSeconds(input.frames.length / input.fps),
    fps: input.fps,
    frameEnd: input.frames.length,
    frameStart: 1,
    frames: input.frames,
    outputDir: input.outputDir,
    pattern: resolve(input.outputDir, 'frame-%06d.png'),
    skippedFrames: input.skippedFrames,
    viewport: deckCanvasSize(input.timedDeck.deck.format),
  }
}

export function createDeckFrameShardArtifact(input: {
  frameCapture: CaptureDeckHtmlFrameSequenceResult
  projectDir: string
  sourceSha256: string
}) {
  const selectedFrames = input.frameCapture.frames
    .filter((frame) => frame.frame >= input.frameCapture.frameStart && frame.frame <= input.frameCapture.frameEnd)
    .map((frame) => ({
      frame: frame.frame,
      path: toProjectPath(input.projectDir, frame.path),
      slideId: frame.slideId,
      time: frame.time,
    }))

  return {
    capturedFrames: input.frameCapture.capturedFrames,
    concurrency: input.frameCapture.concurrency,
    finalized: false,
    fps: input.frameCapture.fps,
    frameCount: input.frameCapture.frames.length,
    frameEnd: input.frameCapture.frameEnd,
    frameStart: input.frameCapture.frameStart,
    frames: selectedFrames,
    generatedAt: new Date().toISOString(),
    outputDir: toProjectPath(input.projectDir, input.frameCapture.outputDir),
    renderer: input.frameCapture.backend,
    skippedFrames: input.frameCapture.skippedFrames,
    source: TIMED_DECK_ARTIFACT_NAME,
    sourceSha256: input.sourceSha256,
    version: 1 as const,
  }
}

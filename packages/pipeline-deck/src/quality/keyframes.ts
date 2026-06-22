import type {TimedDeck} from '@video-agent/ir'
import type {VisualSmokeQualityResult} from '@video-agent/quality'
import type {CaptureDeckHtmlFrameSequenceResult, CaptureDeckHtmlKeyframesResult} from '@video-agent/renderer-html'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {TIMED_DECK_ARTIFACT_NAME} from '@video-agent/ir'
import {runFfmpeg} from '@video-agent/media'
import {checkVisualSmoke} from '@video-agent/quality'
import {deckCanvasSize} from '@video-agent/renderer-deck'
import {selectDeckHtmlKeyframes} from '@video-agent/renderer-html'
import {DECK_FRAME_MANIFEST_ARTIFACT_NAME, DECK_KEYFRAME_CAPTURE_MODE_BROWSER, DECK_KEYFRAME_CAPTURE_MODE_FINAL_VIDEO, DECK_KEYFRAME_CAPTURE_MODE_FRAME_SEQUENCE} from '@video-agent/runtime'
import {createHash} from 'node:crypto'
import {mkdir, readFile, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {DEFAULT_DECK_REVIEW_FRAME_CONCURRENCY, DECK_REVIEW_FRAME_RENDERER, toVisualFrameSample, type DeckKeyframeArtifact, type DeckKeyframeSample, type DeckKeyframeTarget} from './review.js'
import {toProjectPath} from '../project/paths.js'
import {requireSlideTimingDuration, requireTimedDeckDuration, roundSeconds} from '../shared/utils.js'

export async function createDeckFinalVideoKeyframeQuality(workspace: ProjectWorkspace, timedDeck: TimedDeck, outputPath: string, fps: number): Promise<{
  artifact: DeckKeyframeArtifact
  visualQuality: VisualSmokeQualityResult
}> {
  const normalizedFps = requireDeckFinalVideoKeyframeFps(fps)
  const outputDir = resolve(workspace.rendersDir, 'deck-keyframes')
  const targets = createDeckFinalVideoKeyframeTargets(timedDeck, outputDir, normalizedFps)

  await rm(outputDir, {force: true, recursive: true})
  await mkdir(outputDir, {recursive: true})

  const samples = await mapWithConcurrency(targets, DEFAULT_DECK_REVIEW_FRAME_CONCURRENCY, (target) =>
    extractDeckFinalVideoKeyframe(workspace.projectDir, outputPath, target),
  )

  const duration = requireTimedDeckDuration(timedDeck, 'Deck final-video keyframe quality')
  const visualQuality = checkVisualSmoke({
    blackDuration: 0,
    blackSegments: [],
    duration,
    frameSamples: samples.map(toVisualFrameSample),
  })

  return {
    artifact: {
      captureMode: DECK_KEYFRAME_CAPTURE_MODE_FINAL_VIDEO,
      duration,
      fps: normalizedFps,
      generatedAt: new Date().toISOString(),
      renderer: DECK_REVIEW_FRAME_RENDERER,
      samples,
      source: TIMED_DECK_ARTIFACT_NAME,
      version: 1,
      viewport: deckCanvasSize(timedDeck.deck.format),
    },
    visualQuality,
  }
}

export async function createDeckKeyframeQuality(workspace: ProjectWorkspace, frameCapture: CaptureDeckHtmlFrameSequenceResult, browserKeyframes?: CaptureDeckHtmlKeyframesResult): Promise<{
  artifact: DeckKeyframeArtifact
  visualQuality: VisualSmokeQualityResult
}> {
  const captureMode = browserKeyframes === undefined ? DECK_KEYFRAME_CAPTURE_MODE_FRAME_SEQUENCE : DECK_KEYFRAME_CAPTURE_MODE_BROWSER
  const targets = browserKeyframes?.frames ?? selectDeckHtmlKeyframes(frameCapture.frames)
  const samples = await Promise.all(targets.map((target) => readDeckKeyframeSample(workspace.projectDir, target)))
  const visualQuality = checkVisualSmoke({
    blackDuration: 0,
    blackSegments: [],
    duration: browserKeyframes?.duration ?? frameCapture.duration,
    frameSamples: samples.map(toVisualFrameSample),
  })

  return {
    artifact: {
      captureMode,
      duration: browserKeyframes?.duration ?? frameCapture.duration,
      fps: browserKeyframes?.fps ?? frameCapture.fps,
      generatedAt: new Date().toISOString(),
      renderer: browserKeyframes?.backend ?? frameCapture.backend,
      samples,
      source: DECK_FRAME_MANIFEST_ARTIFACT_NAME,
      version: 1,
      viewport: browserKeyframes?.viewport ?? frameCapture.viewport,
    },
    visualQuality,
  }
}

function createDeckFinalVideoKeyframeTargets(timedDeck: TimedDeck, outputDir: string, fps: number): DeckKeyframeTarget[] {
  return timedDeck.timings.map((timing, index) => {
    const duration = requireSlideTimingDuration(timing, 'Deck final-video keyframe quality')
    const time = roundSeconds(timing.start + (duration / 2))

    return {
      frame: Math.round(time * fps) + 1,
      label: 'slide-mid',
      path: resolve(outputDir, `keyframe-${String(index + 1).padStart(6, '0')}.jpg`),
      slideId: timing.slideId,
      time,
    }
  })
}

function requireDeckFinalVideoKeyframeFps(fps: number): number {
  if (!Number.isInteger(fps) || fps <= 0) {
    throw new Error(`Deck final-video keyframe quality fps must be a positive integer; no runtime integer coercion fallback is allowed. Received: ${String(fps)}`)
  }

  return fps
}

async function extractDeckFinalVideoKeyframe(projectDir: string, videoPath: string, target: DeckKeyframeTarget): Promise<DeckKeyframeSample> {
  try {
    await runFfmpeg([
      '-y',
      '-ss',
      String(target.time),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      target.path,
    ])

    return readDeckKeyframeSample(projectDir, target)
  } catch (error) {
    return {
      ...target,
      capturedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      path: toProjectPath(projectDir, target.path),
    }
  }
}

async function mapWithConcurrency<Input, Output>(items: Input[], concurrency: number, iteratee: (item: Input, index: number) => Promise<Output>): Promise<Output[]> {
  const results: Output[] = new Array(items.length)
  const workerCount = Math.min(items.length, requirePositiveInteger(concurrency, 'Deck keyframe concurrency'))
  let nextIndex = 0

  async function runNext(): Promise<void> {
    const index = nextIndex

    nextIndex += 1

    if (index >= items.length) {
      return
    }

    results[index] = await iteratee(items[index] as Input, index)
    await runNext()
  }

  await Promise.all(Array.from({length: workerCount}, () => runNext()))

  return results
}

function requirePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer; no runtime integer coercion fallback is allowed. Received: ${String(value)}`)
  }

  return value
}

async function readDeckKeyframeSample(projectDir: string, target: DeckKeyframeTarget): Promise<DeckKeyframeSample> {
  try {
    const content = await readFile(target.path)

    return {
      ...target,
      capturedAt: new Date().toISOString(),
      ok: true,
      path: toProjectPath(projectDir, target.path),
      sha256: createHash('sha256').update(content).digest('hex'),
      size: content.byteLength,
    }
  } catch (error) {
    return {
      ...target,
      capturedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      path: toProjectPath(projectDir, target.path),
    }
  }
}

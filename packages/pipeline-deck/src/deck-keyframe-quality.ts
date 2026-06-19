import type {TimedDeck} from '@video-agent/ir'
import type {VisualSmokeQualityResult} from '@video-agent/quality'
import type {CaptureDeckHtmlFrameSequenceResult, CaptureDeckHtmlKeyframesResult} from '@video-agent/renderer-html'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {runFfmpeg} from '@video-agent/media'
import {checkVisualSmoke} from '@video-agent/quality'
import {deckCanvasSize} from '@video-agent/renderer-deck'
import {selectDeckHtmlKeyframes} from '@video-agent/renderer-html'
import {createHash} from 'node:crypto'
import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunFile} from '@video-agent/runtime'
import {DEFAULT_DECK_REVIEW_FRAME_CONCURRENCY, DECK_REVIEW_FRAME_RENDERER, toVisualFrameSample, type DeckKeyframeArtifact, type DeckKeyframeSample, type DeckKeyframeTarget} from './deck-review.js'
import {toProjectPath} from './deck-project-paths.js'
import {roundSeconds} from './deck-utils.js'

export async function createDeckFinalVideoKeyframeQuality(workspace: ProjectWorkspace, timedDeck: TimedDeck, outputPath: string, fps: number): Promise<{
  artifact: DeckKeyframeArtifact
  visualQuality: VisualSmokeQualityResult
}> {
  const outputDir = resolve(workspace.rendersDir, 'deck-keyframes')
  const targets = createDeckFinalVideoKeyframeTargets(timedDeck, outputDir, fps)

  await rm(outputDir, {force: true, recursive: true})
  await mkdir(outputDir, {recursive: true})

  const samples = await mapWithConcurrency(targets, DEFAULT_DECK_REVIEW_FRAME_CONCURRENCY, (target) =>
    extractDeckFinalVideoKeyframe(workspace.projectDir, outputPath, target),
  )

  const duration = timedDeck.timings.at(-1)?.end ?? 0
  const visualQuality = checkVisualSmoke({
    blackDuration: 0,
    blackSegments: [],
    duration,
    frameSamples: samples.map(toVisualFrameSample),
  })

  return {
    artifact: {
      captureMode: 'final-video',
      duration,
      fps,
      generatedAt: new Date().toISOString(),
      renderer: DECK_REVIEW_FRAME_RENDERER,
      samples,
      source: 'timed-deck.json',
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
  const captureMode = browserKeyframes === undefined ? 'frame-sequence' : 'browser-keyframes'
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
      source: 'deck-frame-manifest.json',
      version: 1,
      viewport: browserKeyframes?.viewport ?? frameCapture.viewport,
    },
    visualQuality,
  }
}

function createDeckFinalVideoKeyframeTargets(timedDeck: TimedDeck, outputDir: string, fps: number): DeckKeyframeTarget[] {
  return timedDeck.timings.map((timing, index) => {
    const start = Math.max(0, timing.start)
    const end = Math.max(start, timing.end)
    const time = roundSeconds(start + ((end - start) / 2))

    return {
      frame: Math.max(1, Math.round(time * fps) + 1),
      label: 'slide-mid',
      path: resolve(outputDir, `keyframe-${String(index + 1).padStart(6, '0')}.jpg`),
      slideId: timing.slideId,
      time,
    }
  })
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
  const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)))
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

async function readDeckKeyframeSample(projectDir: string, target: DeckKeyframeTarget): Promise<DeckKeyframeSample> {
  try {
    const content = await bunFile(target.path).bytes()

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

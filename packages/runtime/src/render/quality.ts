import type {AudioLoudnessQualityResult, RenderedMediaQualityResult, VisualSmokeQualityResult} from '@video-agent/quality'

import {extractVideoFrame, inspectAudioVolume, inspectVideoBlackDetect, probeMedia} from '@video-agent/media'
import {
  addVisualFrameSamples,
  checkAudioLoudness,
  checkRenderedMedia,
  checkVisualSmoke,
  createAudioLoudnessProbeFailure,
  createRenderedMediaProbeFailure,
  createVisualSmokeProbeFailure,
} from '@video-agent/quality'
import {createHash} from 'node:crypto'
import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunFile} from '../shared/bun-runtime.js'

export async function inspectRenderedOutput(outputPath: string, options: {expectAudio: boolean; expectedDuration: number}): Promise<RenderedMediaQualityResult> {
  try {
    return checkRenderedMedia(await probeMedia(outputPath), options)
  } catch (error) {
    return createRenderedMediaProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

export async function inspectRenderedAudio(outputPath: string): Promise<AudioLoudnessQualityResult> {
  try {
    return checkAudioLoudness(await inspectAudioVolume(outputPath))
  } catch (error) {
    return createAudioLoudnessProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

export async function inspectRenderedVisual(outputPath: string, rendersDir: string, duration?: number): Promise<VisualSmokeQualityResult> {
  const smokeQuality = await inspectRenderedBlackFrames(outputPath, duration)

  return addVisualFrameSamples(smokeQuality, await captureVisualFrameSamples(outputPath, rendersDir, duration))
}

async function inspectRenderedBlackFrames(outputPath: string, duration?: number): Promise<VisualSmokeQualityResult> {
  try {
    return checkVisualSmoke(await inspectVideoBlackDetect(outputPath, duration))
  } catch (error) {
    return createVisualSmokeProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

async function captureVisualFrameSamples(outputPath: string, rendersDir: string, duration?: number): Promise<NonNullable<VisualSmokeQualityResult['frameSample']>[]> {
  return Promise.all(createFrameSampleTargets(rendersDir, duration).map((target) => captureVisualFrameSample(outputPath, target)))
}

async function captureVisualFrameSample(outputPath: string, target: VisualFrameSampleTarget): Promise<NonNullable<VisualSmokeQualityResult['frameSample']>> {
  try {
    await extractVideoFrame(outputPath, target.path, target.timestamp)
    const [content, info] = await Promise.all([bunFile(target.path).bytes(), stat(target.path)])

    return {
      capturedAt: new Date().toISOString(),
      ok: true,
      path: target.path,
      sha256: createHash('sha256').update(content).digest('hex'),
      size: info.size,
      timestamp: target.timestamp,
    }
  } catch (error) {
    return {
      capturedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      path: target.path,
      timestamp: target.timestamp,
    }
  }
}

interface VisualFrameSampleTarget {
  path: string
  timestamp: number
}

function createFrameSampleTargets(rendersDir: string, duration?: number): VisualFrameSampleTarget[] {
  return createFrameSampleTimes(duration).map(({label, timestamp}) => ({
    path: resolve(rendersDir, `final-frame-${label}.jpg`),
    timestamp,
  }))
}

function createFrameSampleTimes(duration?: number): Array<{label: string; timestamp: number}> {
  if (duration === undefined || duration <= 0.2) {
    return [
      {
        label: 'first',
        timestamp: 0,
      },
    ]
  }

  const endTimestamp = Math.max(0, duration - 0.1)
  const middleTimestamp = Math.max(0, duration / 2)
  const samples = [
    {
      label: 'first',
      timestamp: 0,
    },
    {
      label: 'middle',
      timestamp: roundTimestamp(middleTimestamp),
    },
    {
      label: 'end',
      timestamp: roundTimestamp(endTimestamp),
    },
  ]

  return samples.filter((sample, index) => samples.findIndex((other) => other.timestamp === sample.timestamp) === index)
}

function roundTimestamp(value: number): number {
  return Math.round(value * 1000) / 1000
}

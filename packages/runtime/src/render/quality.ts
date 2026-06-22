import type {AudioLoudnessQualityResult, RenderedMediaQualityResult, VisualFrameSample, VisualSmokeQualityResult} from '@video-agent/quality'

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
import {readFile, stat} from 'node:fs/promises'
import {resolve} from 'node:path'

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
  const visualDuration = normalizeVisualInspectionDuration(duration)
  const smokeQuality = await inspectRenderedBlackFrames(outputPath, visualDuration)

  return addVisualFrameSamples(smokeQuality, await captureVisualFrameSamples(outputPath, rendersDir, visualDuration))
}

async function inspectRenderedBlackFrames(outputPath: string, duration?: number): Promise<VisualSmokeQualityResult> {
  try {
    return checkVisualSmoke(await inspectVideoBlackDetect(outputPath, duration))
  } catch (error) {
    return createVisualSmokeProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

async function captureVisualFrameSamples(outputPath: string, rendersDir: string, duration?: number): Promise<VisualFrameSample[]> {
  return Promise.all(createFrameSampleTargets(rendersDir, duration).map((target) => captureVisualFrameSample(outputPath, target)))
}

async function captureVisualFrameSample(outputPath: string, target: VisualFrameSampleTarget): Promise<VisualFrameSample> {
  try {
    await extractVideoFrame(outputPath, target.path, target.timestamp)
    const [content, info] = await Promise.all([readFile(target.path), stat(target.path)])

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

export function createFrameSampleTimes(duration?: number): Array<{label: string; timestamp: number}> {
  const visualDuration = normalizeVisualInspectionDuration(duration)

  if (visualDuration === undefined || visualDuration <= 0.2) {
    return [
      {
        label: 'first',
        timestamp: 0,
      },
    ]
  }

  const endTimestamp = visualDuration - 0.1
  const middleTimestamp = visualDuration / 2
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

function normalizeVisualInspectionDuration(duration: number | undefined): number | undefined {
  if (duration === undefined) {
    return undefined
  }

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Rendered visual inspection duration must be a positive finite number when provided; no frame-sample duration fallback is allowed. Received: ${String(duration)}`)
  }

  return duration
}

function roundTimestamp(value: number): number {
  return Math.round(value * 1000) / 1000
}

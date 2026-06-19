import type {ASRResult, FilmScenes, LongVideoAnalysisFrames, SilencePeriods, SourceManifest, TimelineFusion, VLMAnalysis} from '@video-agent/ir'
import type {ProviderSet, SceneFrameBatch, Transcript, VLMScene} from '@video-agent/providers'

import {extractAudio, extractVideoFrame} from '@video-agent/media'
import {TranscriptSchema, VlmScenesSchema} from '@video-agent/providers'
import {mkdir} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {clamp, rangesOverlap, roundSeconds, uniqueStrings} from './film-utils.js'

export async function createFilmFrameManifest(framesDir: string, sourceManifest: SourceManifest, scenes: FilmScenes): Promise<LongVideoAnalysisFrames> {
  await mkdir(framesDir, {recursive: true})

  const frames = await Promise.all(scenes.scenes.map(async (scene, index) => {
    const timestamp = roundSeconds((scene.sourceRange[0] + scene.sourceRange[1]) / 2)
    const path = join(framesDir, `film-scene-${String(index + 1).padStart(3, '0')}.jpg`)

    await extractVideoFrame(sourceManifest.sourcePath, path, timestamp)

    return {
      path,
      timestamp,
    }
  }))

  return {
    frameCount: frames.length,
    framePattern: join(framesDir, 'film-scene-%03d.jpg'),
    frames,
    sampleFps: sourceManifest.duration > 0 && frames.length > 0 ? frames.length / sourceManifest.duration : 1,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

export async function createFilmAsrResult(audioDir: string, sourceManifest: SourceManifest, providers: ProviderSet): Promise<ASRResult> {
  if (sourceManifest.audioTracks === 0) {
    throw new Error('Film Recap production ASR requires the source video to contain an audio track.')
  }

  await mkdir(audioDir, {recursive: true})

  const audioPath = resolve(audioDir, 'source_audio.wav')

  await extractAudio(sourceManifest.sourcePath, audioPath)

  const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
    duration: sourceManifest.duration,
    path: audioPath,
  }))

  return createFilmAsrResultFromTranscript(transcript, sourceManifest)
}

export function createFilmScenesFromEvidence(sourceManifest: SourceManifest, asrResult: ASRResult, silencePeriods: SilencePeriods, visualSceneChanges: number[], maxScenes: number): FilmScenes {
  const timedSegments = asrResult.segments
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)

  if (timedSegments.length === 0 || asrResult.timestampConfidence === 'untimed') {
    throw new Error('Film Recap production scene planning requires timed ASR segments.')
  }

  const ranges = limitSceneRanges(createSceneRangesFromBoundaries(sourceManifest.duration, [
    0,
    ...visualSceneChanges,
    ...silencePeriods.periods.flatMap((period) => silencePeriodBoundary(period, sourceManifest.duration)),
    sourceManifest.duration,
  ]), normalizeFilmSceneLimit(maxScenes))
  const scenes = ranges.map((range, index) => {
    const matchingAsr = timedSegments.filter((segment) => rangesOverlap([segment.start, segment.end], range))
    const summary = matchingAsr.map((segment) => segment.text).join(' ').trim()

    return {
      id: `scene-${String(index + 1).padStart(3, '0')}`,
      sourceRange: range,
      ...(summary === '' ? {} : {summary}),
    }
  }).filter((scene) => scene.sourceRange[1] > scene.sourceRange[0])

  if (scenes.length === 0) {
    throw new Error('Film Recap production scene planning produced no evidence-backed scenes.')
  }

  return {
    scenes,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

export function createFilmSilencePeriods(sourceManifest: SourceManifest, asrResult: ASRResult): SilencePeriods {
  if (sourceManifest.audioTracks === 0) {
    throw new Error('Film Recap production silence detection requires the source video to contain an audio track.')
  }

  const timedSegments = asrResult.segments
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const periods: SilencePeriods['periods'] = []
  let cursor = 0

  for (const segment of timedSegments) {
    if (segment.start > cursor) {
      periods.push({
        end: roundSeconds(segment.start),
        id: `silence-${String(periods.length + 1).padStart(3, '0')}`,
        reason: 'detected',
        start: roundSeconds(cursor),
      })
    }

    cursor = Math.max(cursor, segment.end)
  }

  if (cursor < sourceManifest.duration) {
    periods.push({
      end: roundSeconds(sourceManifest.duration),
      id: `silence-${String(periods.length + 1).padStart(3, '0')}`,
      reason: 'detected',
      start: roundSeconds(cursor),
    })
  }

  return {
    periods,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

export async function createFilmVlmAnalysis(sourceManifest: SourceManifest, scenes: FilmScenes, frames: LongVideoAnalysisFrames, providers: ProviderSet): Promise<VLMAnalysis> {
  if (scenes.scenes.length === 0) {
    return {
      scenes: [],
      source: sourceManifest.sourcePath,
      version: 1,
    }
  }

  const batches = createFilmSceneFrameBatches(scenes, frames)
  const providerScenes = validateFilmVlmScenes(batches, VlmScenesSchema.parse(await providers.vlm.analyzeScenes(batches, 'film-recap source understanding')))

  return createFilmVlmAnalysisFromProvider(sourceManifest, scenes, batches, providerScenes)
}

export function createTimelineFusion(
  sourceManifest: SourceManifest,
  scenes: FilmScenes,
  asrResult: ASRResult,
  silencePeriods: SilencePeriods,
  vlmAnalysis: VLMAnalysis,
): TimelineFusion {
  return {
    items: scenes.scenes.map((scene, index) => {
      const matchingVlm = vlmAnalysis.scenes.filter((analysis) => analysis.sceneId === scene.id)
      const matchingAsr = asrResult.segments.filter((segment) => rangesOverlap([segment.start, segment.end], scene.sourceRange))
      const matchingSilence = silencePeriods.periods.filter((period) => rangesOverlap([period.start, period.end], scene.sourceRange))

      return {
        asrSegmentIds: matchingAsr.map((segment) => segment.id),
        evidence: [
          {ref: `scenes.json#${scene.id}`, text: scene.summary, type: 'vlm'},
          ...matchingAsr.map((segment) => ({ref: `asr-result.json#${segment.id}`, text: segment.text, type: 'asr' as const})),
          ...matchingVlm.map((analysis) => ({ref: `vlm-analysis.json#${analysis.id}`, text: analysis.summary, type: 'vlm' as const})),
        ],
        id: `fusion-${String(index + 1).padStart(3, '0')}`,
        sceneId: scene.id,
        silencePeriodIds: matchingSilence.map((period) => period.id),
        sourceRange: scene.sourceRange,
        summary: scene.summary ?? `Fused evidence for ${scene.id}.`,
        vlmAnalysisIds: matchingVlm.map((analysis) => analysis.id),
      }
    }),
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function createFilmAsrResultFromTranscript(transcript: Transcript, sourceManifest: SourceManifest): ASRResult {
  const timestampConfidence = transcript.timestampConfidence ?? inferTranscriptTimestampConfidence(transcript)
  const segments = transcript.segments
    .map((segment, index) => {
      const start = roundSeconds(clamp(segment.start, 0, sourceManifest.duration))
      const end = roundSeconds(clamp(segment.end, start, sourceManifest.duration))
      const text = segment.text.trim()

      if (text === '') {
        return undefined
      }

      return {
        ...(segment.speaker === undefined ? {} : {speaker: segment.speaker}),
        end,
        id: `asr-${String(index + 1).padStart(4, '0')}`,
        start,
        text,
        timestampConfidence,
      }
    })
    .filter((segment): segment is ASRResult['segments'][number] => segment !== undefined)

  return {
    language: transcript.language ?? 'unknown',
    segments,
    text: transcript.text,
    timestampConfidence,
    version: 1,
  }
}

function inferTranscriptTimestampConfidence(transcript: Transcript): ASRResult['timestampConfidence'] {
  return transcript.segments.some((segment) => segment.end > segment.start) ? 'exact' : 'untimed'
}

function createSceneRangesFromBoundaries(sourceDuration: number, rawBoundaries: number[]): Array<[number, number]> {
  const safeDuration = Math.max(sourceDuration, 0.001)
  const boundaries = uniqueRoundedSeconds(rawBoundaries
    .map((value) => clamp(value, 0, safeDuration))
    .filter((value) => value >= 0 && value <= safeDuration))
    .sort((left, right) => left - right)
  const completeBoundaries = ensureBoundaryEdges(boundaries, safeDuration)
  const ranges: Array<[number, number]> = []

  for (let index = 0; index < completeBoundaries.length - 1; index += 1) {
    const start = completeBoundaries[index]
    const end = completeBoundaries[index + 1]

    if (end - start >= 0.05) {
      ranges.push([start, end])
    }
  }

  return ranges.length === 0 ? [[0, safeDuration]] : ranges
}

function silencePeriodBoundary(period: SilencePeriods['periods'][number], sourceDuration: number): number[] {
  const duration = period.end - period.start

  if (duration < 0.25 || period.start <= 0 || period.end >= sourceDuration) {
    return []
  }

  return [roundSeconds((period.start + period.end) / 2)]
}

function limitSceneRanges(ranges: Array<[number, number]>, maxScenes: number): Array<[number, number]> {
  const limited = [...ranges]
  const target = Math.max(1, Math.floor(Number.isFinite(maxScenes) ? maxScenes : limited.length))

  while (limited.length > target) {
    const mergeIndex = findShortestAdjacentSceneMerge(limited)
    const left = limited[mergeIndex]
    const right = limited[mergeIndex + 1]

    limited.splice(mergeIndex, 2, [left[0], right[1]])
  }

  return limited.map((range) => [roundSeconds(range[0]), roundSeconds(range[1])] as [number, number])
}

function findShortestAdjacentSceneMerge(ranges: Array<[number, number]>): number {
  let bestIndex = 0
  let bestDuration = Number.POSITIVE_INFINITY

  for (let index = 0; index < ranges.length - 1; index += 1) {
    const duration = ranges[index + 1][1] - ranges[index][0]

    if (duration < bestDuration) {
      bestDuration = duration
      bestIndex = index
    }
  }

  return bestIndex
}

function ensureBoundaryEdges(boundaries: number[], sourceDuration: number): number[] {
  return uniqueRoundedSeconds([
    0,
    ...boundaries,
    sourceDuration,
  ])
}

function uniqueRoundedSeconds(values: number[]): number[] {
  return [...new Set(values.map(roundSeconds))]
}

function normalizeFilmSceneLimit(maxScenes: number): number {
  const requested = Number.isFinite(maxScenes) ? Math.floor(maxScenes) : 12

  return Math.max(1, requested)
}

function validateFilmVlmScenes(batches: SceneFrameBatch[], providerScenes: VLMScene[]): VLMScene[] {
  if (providerScenes.length !== batches.length) {
    throw new Error(`VLM provider returned ${providerScenes.length} film scene(s), expected ${batches.length}.`)
  }

  for (const [index, batch] of batches.entries()) {
    if (providerScenes[index]?.sceneId !== batch.sceneId) {
      throw new Error(`VLM provider returned sceneId ${JSON.stringify(providerScenes[index]?.sceneId)} at index ${index}, expected ${JSON.stringify(batch.sceneId)}.`)
    }
  }

  return providerScenes
}

function createFilmSceneFrameBatches(scenes: FilmScenes, frames: LongVideoAnalysisFrames): SceneFrameBatch[] {
  return scenes.scenes.map((scene, index) => {
    const matchingFrames = frames.frames
      .filter((frame) => frame.timestamp >= scene.sourceRange[0] && frame.timestamp <= scene.sourceRange[1])
      .map((frame) => frame.path)
    const indexedFrame = frames.frames[index]?.path

    if (matchingFrames.length === 0 && indexedFrame === undefined) {
      throw new Error(`No analysis frame is available for film scene ${scene.id}.`)
    }

    return {
      frames: matchingFrames.length === 0 ? [indexedFrame] : matchingFrames,
      sceneId: scene.id,
      timeRange: scene.sourceRange,
    }
  })
}

function createFilmVlmAnalysisFromProvider(sourceManifest: SourceManifest, scenes: FilmScenes, batches: SceneFrameBatch[], providerScenes: VLMScene[]): VLMAnalysis {
  const scenesById = new Map(scenes.scenes.map((scene) => [scene.id, scene]))
  const batchesById = new Map(batches.map((batch) => [batch.sceneId, batch]))

  return {
    scenes: providerScenes.map((providerScene, index) => {
      const scene = scenesById.get(providerScene.sceneId)
      const batch = batchesById.get(providerScene.sceneId)
      const sourceRange = scene?.sourceRange ?? batch?.timeRange ?? [0, sourceManifest.duration] as [number, number]

      return {
        actions: uniqueStrings(providerScene.actions ?? []),
        characters: uniqueStrings(providerScene.characters ?? []),
        emotions: uniqueStrings(providerScene.emotions ?? []),
        evidence: providerScene.evidence.map((ref) => ({ref, text: providerScene.description, type: 'vlm' as const})),
        id: `vlm-${String(index + 1).padStart(3, '0')}`,
        plotClues: uniqueStrings(providerScene.plotClues ?? []),
        relationships: uniqueStrings(providerScene.relationships ?? []),
        sceneId: providerScene.sceneId,
        sourceRange,
        summary: providerScene.description,
      }
    }),
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

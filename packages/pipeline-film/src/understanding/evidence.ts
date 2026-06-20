import type {ASRResult, FilmScenes, LongVideoAnalysisFrames, SilencePeriods, SourceManifest, TimelineFusion, VLMAnalysis} from '@video-agent/ir'
import type {ProviderSet, SceneFrameBatch, Transcript, VLMScene} from '@video-agent/providers'

import {extractAudio, extractVideoFrame} from '@video-agent/media'
import {TranscriptSchema, VlmScenesSchema} from '@video-agent/providers'
import {mkdir} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {clamp, rangesOverlap, roundSeconds, uniqueStrings} from '../shared/utils.js'

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
  requireTimedAsrSegments(asrResult, 'Film Recap production scene planning', {
    allowEmpty: false,
  })

  const ranges = limitSceneRanges(createSceneRangesFromBoundaries(sourceManifest.duration, [
    0,
    ...visualSceneChanges,
    ...silencePeriods.periods.flatMap((period) => silencePeriodBoundary(period, sourceManifest.duration)),
    sourceManifest.duration,
  ]), normalizeFilmSceneLimit(maxScenes))
  const scenes = ranges.map((range, index) => ({
    id: `scene-${String(index + 1).padStart(3, '0')}`,
    sourceRange: range,
  })).filter((scene) => scene.sourceRange[1] > scene.sourceRange[0])

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

  const timedSegments = requireTimedAsrSegments(asrResult, 'Film Recap production silence detection', {
    allowEmpty: true,
  })
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
      const summary = resolveTimelineFusionSummary(scene, matchingVlm)

      return {
        asrSegmentIds: matchingAsr.map((segment) => segment.id),
        evidence: [
          ...matchingAsr.map((segment) => ({ref: `asr-result.json#${segment.id}`, text: segment.text, type: 'asr' as const})),
          ...matchingVlm.map((analysis) => ({ref: `vlm-analysis.json#${analysis.id}`, text: analysis.summary, type: 'vlm' as const})),
        ],
        id: `fusion-${String(index + 1).padStart(3, '0')}`,
        sceneId: scene.id,
        silencePeriodIds: matchingSilence.map((period) => period.id),
        sourceRange: scene.sourceRange,
        summary,
        vlmAnalysisIds: matchingVlm.map((analysis) => analysis.id),
      }
    }),
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function resolveTimelineFusionSummary(scene: FilmScenes['scenes'][number], matchingVlm: VLMAnalysis['scenes']): string {
  for (const [index, analysis] of matchingVlm.entries()) {
    if (analysis.summary.trim() === '') {
      throw new Error(`Timeline fusion VLM summary ${index + 1} for ${scene.id} is empty; no runtime VLM summary filtering is allowed.`)
    }

    if (analysis.summary !== analysis.summary.trim()) {
      throw new Error(`Timeline fusion VLM summary ${index + 1} for ${scene.id} contains leading or trailing whitespace; no runtime VLM summary trim is allowed.`)
    }

    return analysis.summary
  }

  throw new Error(`Timeline fusion item for ${scene.id} has no VLM evidence summary.`)
}

export function createFilmAsrResultFromTranscript(transcript: Transcript, sourceManifest: SourceManifest): ASRResult {
  if (transcript.language === undefined || transcript.language.trim() === '') {
    throw new Error('Film Recap ASR output must include an explicit transcript language.')
  }

  if (transcript.text !== transcript.text.trim()) {
    throw new Error('Film Recap ASR transcript text contains leading or trailing whitespace; no runtime transcript text trim is allowed.')
  }

  if (transcript.timestampConfidence === undefined) {
    throw new Error('Film Recap ASR output must include explicit timestampConfidence; no timestamp confidence inference is allowed.')
  }

  const timestampConfidence = transcript.timestampConfidence
  const segments = transcript.segments
    .map((segment, index): ASRResult['segments'][number] => {
      const start = roundSeconds(segment.start)
      const end = roundSeconds(segment.end)
      const text = segment.text

      if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || start < 0 || end > sourceManifest.duration || end <= start) {
        throw new Error(`Film Recap ASR segment ${index + 1} timestamp range must stay within source duration; no timestamp clipping is allowed.`)
      }

      if (text.trim() === '') {
        throw new Error(`Film Recap ASR segment ${index + 1} is empty; no silent ASR segment filtering is allowed.`)
      }

      if (text !== text.trim()) {
        throw new Error(`Film Recap ASR segment ${index + 1} text contains leading or trailing whitespace; no runtime ASR segment text trim is allowed.`)
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

  return {
    language: transcript.language,
    segments,
    text: transcript.text,
    timestampConfidence,
    version: 1,
  }
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

function requireTimedAsrSegments(asrResult: ASRResult, context: string, options: {allowEmpty: boolean}): ASRResult['segments'] {
  if (asrResult.timestampConfidence === 'untimed') {
    throw new Error(`${context} requires timed ASR segments; no untimed ASR fallback is allowed.`)
  }

  if (!options.allowEmpty && asrResult.segments.length === 0) {
    throw new Error(`${context} requires non-empty timed ASR segments; no transcript-wide fallback is allowed.`)
  }

  asrResult.segments.forEach((segment, index) => {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.end <= segment.start) {
      throw new Error(`${context} ASR segment ${index + 1} must provide a positive timestamp range; no silent ASR segment filtering is allowed.`)
    }
  })

  return [...asrResult.segments].sort((left, right) => left.start - right.start || left.end - right.end)
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
  return scenes.scenes.map((scene) => {
    const matchingFrames = frames.frames
      .filter((frame) => frame.timestamp >= scene.sourceRange[0] && frame.timestamp <= scene.sourceRange[1])
      .map((frame) => frame.path)

    if (matchingFrames.length === 0) {
      throw new Error(`No analysis frame timestamp falls within film scene ${scene.id}; no indexed frame fallback is allowed.`)
    }

    return {
      frames: matchingFrames,
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

      if (scene === undefined || batch === undefined) {
        throw new Error(`VLM provider returned sceneId ${JSON.stringify(providerScene.sceneId)} without a matching film scene batch.`)
      }

      const description = requireCleanProviderSceneText(providerScene.description, providerScene.sceneId, 'description')

      return {
        actions: uniqueStrings(requireProviderSceneStrings(providerScene.actions, providerScene.sceneId, 'actions'), `VLM provider scene "${providerScene.sceneId}" actions`),
        characters: uniqueStrings(requireProviderSceneStrings(providerScene.characters, providerScene.sceneId, 'characters'), `VLM provider scene "${providerScene.sceneId}" characters`),
        emotions: uniqueStrings(requireProviderSceneStrings(providerScene.emotions, providerScene.sceneId, 'emotions'), `VLM provider scene "${providerScene.sceneId}" emotions`),
        evidence: providerScene.evidence.map((ref) => ({ref, text: description, type: 'vlm' as const})),
        id: `vlm-${String(index + 1).padStart(3, '0')}`,
        plotClues: uniqueStrings(requireProviderSceneStrings(providerScene.plotClues, providerScene.sceneId, 'plotClues'), `VLM provider scene "${providerScene.sceneId}" plotClues`),
        relationships: uniqueStrings(requireProviderSceneStrings(providerScene.relationships, providerScene.sceneId, 'relationships'), `VLM provider scene "${providerScene.sceneId}" relationships`),
        sceneId: providerScene.sceneId,
        sourceRange: scene.sourceRange,
        summary: description,
      }
    }),
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function requireCleanProviderSceneText(value: string, sceneId: string, field: string): string {
  if (value.trim() === '') {
    throw new Error(`VLM provider scene "${sceneId}" ${field} is empty; no runtime VLM text filtering is allowed.`)
  }

  if (value !== value.trim()) {
    throw new Error(`VLM provider scene "${sceneId}" ${field} contains leading or trailing whitespace; no runtime VLM text trim is allowed.`)
  }

  return value
}

function requireProviderSceneStrings(value: string[] | undefined, sceneId: string, field: string): string[] {
  if (value === undefined) {
    throw new Error(`VLM provider scene "${sceneId}" is missing required semantic field "${field}".`)
  }

  return value
}

import type {Narration, NarrationSegment, RecapScript, StoryIndex} from '@video-agent/ir'
import type {MediaInput, ProviderCostMetadata, ProviderResponseMetadata, ProviderSet, ProviderUsageMetadata, SceneFrameBatch, Transcript, TTSSegment, VLMScene} from '@video-agent/providers'

import {ProviderExecutionError, ProviderResponseValidationError, readProviderMetadata} from '@video-agent/providers'
import {randomUUID} from 'node:crypto'
import {appendFile, mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

export type ProviderCallRole = 'asr' | 'script' | 'tts' | 'vlm'
export type ProviderCallStatus = 'failed' | 'succeeded'

export interface ProviderCallRecord {
  completedAt: string
  cost?: ProviderCostMetadata
  durationMs: number
  error?: {
    code?: string
    details?: Record<string, unknown>
    message: string
    name: string
    retryable?: boolean
    validationIssues?: {
      code: string
      message: string
      path: string[]
    }[]
  }
  input: Record<string, unknown>
  model?: string
  operation: string
  output?: Record<string, unknown>
  provider: string
  requestId: string
  role: ProviderCallRole
  startedAt: string
  status: ProviderCallStatus
  usage?: ProviderUsageMetadata
  version: 1
}

export interface ProviderCallStartRecord {
  input: Record<string, unknown>
  operation: string
  provider: string
  requestId: string
  role: ProviderCallRole
  startedAt: string
  status: 'started'
  version: 1
}

export interface ProviderCallRecorder {
  record(call: ProviderCallRecord): Promise<void>
  start?(call: ProviderCallStartRecord): Promise<void>
}

export interface ProviderSelection {
  asr: string
  tts: string
  vlm: string
}

export function createJsonlProviderCallRecorder(path: string): ProviderCallRecorder {
  return {
    async record(call) {
      await mkdir(dirname(path), {recursive: true})
      await appendFile(path, `${JSON.stringify(call)}\n`)
    },
  }
}

export function instrumentProviders(providers: ProviderSet, selection: ProviderSelection, recorder: ProviderCallRecorder): ProviderSet {
  return {
    asr: {
      async transcribe(input) {
        return recordProviderCall({
          call: () => providers.asr.transcribe(input),
          input: summarizeMediaInput(input),
          operation: 'transcribe',
          output: summarizeTranscript,
          provider: selection.asr,
          recorder,
          role: 'asr',
        })
      },
    },
    script: {
      async createNarration(input) {
        return recordProviderCall({
          call: () => providers.script.createNarration(input),
          input: {
            clips: input.clipPlan.clips.length,
            scenes: input.storyboard.scenes.length,
          },
          operation: 'createNarration',
          output: summarizeNarration,
          provider: 'script',
          recorder,
          role: 'script',
        })
      },
      async createRecapScript(input) {
        return recordProviderCall({
          call: () => providers.script.createRecapScript(input),
          input: {
            beats: input.storyIndex.beats.length,
            sourceDuration: input.sourceManifest.duration,
            targetDurationSeconds: input.targetDurationSeconds,
          },
          operation: 'createRecapScript',
          output: summarizeRecapScript,
          provider: 'script',
          recorder,
          role: 'script',
        })
      },
      async createStoryIndex(input) {
        return recordProviderCall({
          call: () => providers.script.createStoryIndex(input),
          input: {
            language: input.language,
            sourceDuration: input.sourceManifest.duration,
            timelineItems: input.timelineFusion.items.length,
            vlmScenes: input.vlmAnalysis.scenes.length,
          },
          operation: 'createStoryIndex',
          output: summarizeStoryIndex,
          provider: 'script',
          recorder,
          role: 'script',
        })
      },
    },
    storyboard: providers.storyboard,
    tts: {
      async synthesize(segments, options) {
        return recordProviderCall({
          call: () => providers.tts.synthesize(segments, options),
          input: summarizeNarrationSegments(segments),
          operation: 'synthesize',
          output: summarizeTtsSegments,
          provider: selection.tts,
          recorder,
          role: 'tts',
        })
      },
    },
    vlm: {
      async analyzeScenes(input, context) {
        return recordProviderCall({
          call: () => providers.vlm.analyzeScenes(input, context),
          input: summarizeSceneFrameBatches(input, context),
          operation: 'analyzeScenes',
          output: summarizeVlmScenes,
          provider: selection.vlm,
          recorder,
          role: 'vlm',
        })
      },
    },
  }
}

interface RecordProviderCallOptions<T> {
  call: () => Promise<T>
  input: Record<string, unknown>
  operation: string
  output: (value: T) => Record<string, unknown>
  provider: string
  recorder: ProviderCallRecorder
  role: ProviderCallRole
}

async function recordProviderCall<T>(options: RecordProviderCallOptions<T>): Promise<T> {
  const startedAtMs = Date.now()
  const startedAt = new Date(startedAtMs).toISOString()
  const fallbackRequestId = createProviderRequestId(options.role)

  await options.recorder.start?.({
    input: options.input,
    operation: options.operation,
    provider: options.provider,
    requestId: fallbackRequestId,
    role: options.role,
    startedAt,
    status: 'started',
    version: 1,
  })

  try {
    const output = await options.call()
    const completedAtMs = Date.now()
    const metadata = readProviderMetadata(output)

    await options.recorder.record({
      completedAt: new Date(completedAtMs).toISOString(),
      ...serializeProviderMetadata(metadata, fallbackRequestId),
      durationMs: completedAtMs - startedAtMs,
      input: options.input,
      operation: options.operation,
      output: options.output(output),
      provider: options.provider,
      role: options.role,
      startedAt,
      status: 'succeeded',
      version: 1,
    })

    return output
  } catch (error) {
    const completedAtMs = Date.now()

    await options.recorder.record({
      completedAt: new Date(completedAtMs).toISOString(),
      durationMs: completedAtMs - startedAtMs,
      error: normalizeError(error),
      input: options.input,
      operation: options.operation,
      provider: options.provider,
      requestId: fallbackRequestId,
      role: options.role,
      startedAt,
      status: 'failed',
      version: 1,
    })

    throw error
  }
}

function createProviderRequestId(role: ProviderCallRole): string {
  return `${role}_${randomUUID()}`
}

function serializeProviderMetadata(metadata: ProviderResponseMetadata | undefined, fallbackRequestId: string): Pick<ProviderCallRecord, 'cost' | 'model' | 'requestId' | 'usage'> {
  return {
    ...(metadata?.cost === undefined ? {} : {cost: metadata.cost}),
    ...(metadata?.model === undefined ? {} : {model: metadata.model}),
    requestId: metadata?.requestId ?? fallbackRequestId,
    ...(metadata?.usage === undefined ? {} : {usage: metadata.usage}),
  }
}

function summarizeMediaInput(input: MediaInput): Record<string, unknown> {
  return {
    ...(input.mimeType === undefined ? {} : {mimeType: input.mimeType}),
    path: input.path,
  }
}

function summarizeSceneFrameBatches(input: SceneFrameBatch[], context: string | undefined): Record<string, unknown> {
  return {
    ...(context === undefined ? {} : {contextLength: context.length}),
    frames: input.reduce((count, batch) => count + batch.frames.length, 0),
    scenes: input.length,
  }
}

function summarizeNarrationSegments(segments: NarrationSegment[]): Record<string, unknown> {
  return {
    segments: segments.length,
    textLength: segments.reduce((count, segment) => count + segment.text.length, 0),
  }
}

function summarizeNarration(narration: Narration): Record<string, unknown> {
  return {
    segments: narration.segments.length,
    textLength: narration.segments.reduce((count, segment) => count + segment.text.length, 0),
  }
}

function summarizeRecapScript(script: RecapScript): Record<string, unknown> {
  return {
    segments: script.segments.length,
    textLength: script.segments.reduce((count, segment) => count + segment.narrationText.length, 0),
    totalEstimatedDuration: script.totalEstimatedDuration,
  }
}

function summarizeStoryIndex(output: {storyIndex: StoryIndex}): Record<string, unknown> {
  return {
    beats: output.storyIndex.beats.length,
    characters: output.storyIndex.characters.length,
    language: output.storyIndex.language,
  }
}

function summarizeTranscript(transcript: Transcript): Record<string, unknown> {
  return {
    ...(transcript.language === undefined ? {} : {language: transcript.language}),
    segments: transcript.segments.length,
    ...(transcript.timestampConfidence === undefined ? {} : {timestampConfidence: transcript.timestampConfidence}),
    textLength: transcript.text.length,
  }
}

function summarizeVlmScenes(scenes: VLMScene[]): Record<string, unknown> {
  return {
    evidence: scenes.reduce((count, scene) => count + scene.evidence.length, 0),
    scenes: scenes.length,
  }
}

function summarizeTtsSegments(segments: TTSSegment[]): Record<string, unknown> {
  return {
    duration: segments.reduce((duration, segment) => duration + segment.duration, 0),
    segments: segments.length,
  }
}

function normalizeError(error: unknown): ProviderCallRecord['error'] {
  if (error instanceof ProviderExecutionError) {
    return {
      code: error.code,
      ...(error.details === undefined ? {} : {details: error.details}),
      message: error.message,
      name: error.name,
      retryable: error.retryable,
    }
  }

  if (error instanceof ProviderResponseValidationError) {
    return {
      message: error.message,
      name: error.name,
      retryable: false,
      validationIssues: error.issues,
    }
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: String(error),
    name: 'Error',
  }
}

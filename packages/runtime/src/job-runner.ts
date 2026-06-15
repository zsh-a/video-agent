import type {PipelineContext, PipelineEvent, Stage} from '@video-agent/core'
import type {JobStore} from '@video-agent/db'
import type {ArtifactRef, ClipPlan, MediaInfo, Narration, Storyboard, Timeline} from '@video-agent/ir'
import type {LLMClient} from '@video-agent/llm'
import type {ProviderSet, SceneFrameBatch, Transcript, TTSSegment, VLMScene} from '@video-agent/providers'

import {createClipPlan, createSceneBoundariesFromTranscript, createTimelineFromClipPlan, runPipeline} from '@video-agent/core'
import {ClipPlanSchema, MediaInfoSchema, NarrationSchema, StoryboardSchema, TimelineSchema} from '@video-agent/ir'
import {createLLMClientFromConfig} from '@video-agent/llm'
import {createPreview, extractAudio, extractFrames, probeMedia} from '@video-agent/media'
import {createProviders, TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {checkClipPlanConsistency, checkNarrationTiming, checkStoryboardConsistency, checkTimelineBounds, checkTtsCoverage, type QualityIssue} from '@video-agent/quality'
import {appendFile, mkdir} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {refreshArtifactManifest} from './artifact-store.js'
import {verifyProjectArtifacts} from './artifacts.js'
import {bunFile} from './bun-runtime.js'
import {readConfig} from './config.js'
import {readRuntimeEnv} from './env.js'
import {assertFileExists} from './file-io.js'
import {createConfiguredJobStore} from './job-store.js'
import {createJsonlProviderCallRecorder, instrumentProviders, type ProviderCallRecord, type ProviderCallRecorder, type ProviderCallStartRecord} from './provider-calls.js'
import {createProviderEnv} from './provider-settings.js'
import {createProjectWorkspace, type ProjectWorkspace} from './workspace.js'

export interface RunInitialPipelineOptions {
  fromStage?: InitialPipelineStage
  inputPath: string
  llmClient?: LLMClient
  onEvent?: (event: PipelineEvent) => Promise<void> | void
  onProviderCall?: (call: ProviderCallRecord) => Promise<void> | void
  onProviderCallStart?: (call: ProviderCallStartRecord) => Promise<void> | void
  projectId?: string
  workspaceDir?: string
}

export type InitialPipelineStage = 'ingest' | 'plan' | 'quality' | 'script' | 'understand' | 'voiceover'

export interface RunInitialPipelineResult {
  artifacts: {
    clipPlan: string
    frames?: string
    ingestReport: string
    mediaInfo: string
    narration: string
    pipelineEvents: string
    preview: string
    providerCalls: string
    qualityReport: string
    sceneAnalysis: string
    sourceAudio?: string
    storyboard: string
    timeline: string
    transcript: string
    ttsSegments: string
  }
  projectDir: string
  projectId: string
  status: 'completed' | 'failed'
}

interface InitialPipelineInput {
  inputPath: string
  providers: PipelineProviders
  workspace: ProjectWorkspace
}

interface IngestOutput extends InitialPipelineInput {
  artifacts: RunInitialPipelineResult['artifacts']
  mediaInfo: MediaInfo
}

interface UnderstandOutput extends IngestOutput {
  sceneAnalysis: VLMScene[]
  transcript: Transcript
}

interface PlanOutput extends UnderstandOutput {
  clipPlan: ClipPlan
  storyboard: Storyboard
  timeline: Timeline
}

interface ScriptOutput extends PlanOutput {
  narration: Narration
}

interface VoiceoverOutput extends ScriptOutput {
  ttsSegments: TTSSegment[]
}

interface QualityOutput extends VoiceoverOutput {
  issues: QualityIssue[]
}

interface PipelineProviders {
  asr: ProviderSet['asr']
  script: ProviderSet['script']
  storyboard: ProviderSet['storyboard']
  tts: ProviderSet['tts']
  vlm: ProviderSet['vlm']
}

type InitialStageInput = IngestOutput | InitialPipelineInput | PlanOutput | ScriptOutput | UnderstandOutput | VoiceoverOutput
type InitialStageOutput = IngestOutput | PlanOutput | QualityOutput | ScriptOutput | UnderstandOutput | VoiceoverOutput

const STAGES: readonly InitialPipelineStage[] = ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality']

const CHECKPOINT_ARTIFACTS_BY_STAGE: Record<InitialPipelineStage, readonly string[]> = {
  ingest: [],
  plan: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json'],
  quality: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json', 'storyboard.json', 'clip-plan.json', 'timeline.json', 'narration.json', 'tts-segments.json'],
  script: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json', 'storyboard.json', 'clip-plan.json', 'timeline.json'],
  understand: ['ingest-report.json', 'media-info.json'],
  voiceover: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json', 'storyboard.json', 'clip-plan.json', 'timeline.json', 'narration.json'],
}

export class PipelineCheckpointError extends Error {
  readonly changedArtifacts: string[]
  readonly fromStage: InitialPipelineStage
  readonly missingArtifacts: string[]
  readonly schemaInvalidArtifacts: string[]
  readonly untrackedArtifacts: string[]

  constructor(fromStage: InitialPipelineStage, issues: {changedArtifacts?: string[]; missingArtifacts?: string[]; schemaInvalidArtifacts?: string[]; untrackedArtifacts?: string[]}) {
    const changedArtifacts = issues.changedArtifacts ?? []
    const missingArtifacts = issues.missingArtifacts ?? []
    const schemaInvalidArtifacts = issues.schemaInvalidArtifacts ?? []
    const untrackedArtifacts = issues.untrackedArtifacts ?? []
    const issueMessages = [
      ...(missingArtifacts.length === 0 ? [] : [`missing: ${missingArtifacts.join(', ')}`]),
      ...(changedArtifacts.length === 0 ? [] : [`changed: ${changedArtifacts.join(', ')}`]),
      ...(schemaInvalidArtifacts.length === 0 ? [] : [`schema invalid: ${schemaInvalidArtifacts.join(', ')}`]),
      ...(untrackedArtifacts.length === 0 ? [] : [`untracked: ${untrackedArtifacts.join(', ')}`]),
    ]

    super(`Cannot resume from ${fromStage}; checkpoint artifact issue(s): ${issueMessages.join('; ')}.`)
    this.changedArtifacts = changedArtifacts
    this.fromStage = fromStage
    this.missingArtifacts = missingArtifacts
    this.schemaInvalidArtifacts = schemaInvalidArtifacts
    this.untrackedArtifacts = untrackedArtifacts
    this.name = 'PipelineCheckpointError'
  }
}

export async function runInitialPipeline(options: RunInitialPipelineOptions): Promise<RunInitialPipelineResult> {
  const inputPath = resolve(options.inputPath)

  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const pipelineEventsPath = workspace.store.resolve('pipeline-events.jsonl')
  const providerCallsPath = workspace.store.resolve('provider-calls.jsonl')
  const artifacts: RunInitialPipelineResult['artifacts'] = {
    clipPlan: workspace.store.resolve('clip-plan.json'),
    ingestReport: workspace.store.resolve('ingest-report.json'),
    mediaInfo: workspace.store.resolve('media-info.json'),
    narration: workspace.store.resolve('narration.json'),
    pipelineEvents: pipelineEventsPath,
    preview: join(workspace.rendersDir, 'preview.mp4'),
    providerCalls: providerCallsPath,
    qualityReport: workspace.store.resolve('quality-report.json'),
    sceneAnalysis: workspace.store.resolve('scene-analysis.json'),
    storyboard: workspace.store.resolve('storyboard.json'),
    timeline: workspace.store.resolve('timeline.json'),
    transcript: workspace.store.resolve('transcript.json'),
    ttsSegments: workspace.store.resolve('tts-segments.json'),
  }
  const config = await readConfig(workspace.workspaceDir)
  const providerEnv = createProviderEnv(config, await readRuntimeEnv(workspace.workspaceDir))
  const llmClient = options.llmClient ?? createLLMClientFromConfig(config.llm, {
    env: providerEnv,
  })
  const providerSet = createProviders(config, {env: providerEnv, llmClient})
  const providers = instrumentProviders(providerSet, config.providers, createRuntimeProviderCallRecorder(providerCallsPath, options.onProviderCall, options.onProviderCallStart))
  const ctx = {
    artifactsDir: workspace.artifactsDir,
    emit: async (event: PipelineEvent) => appendEvent(pipelineEventsPath, event),
    projectId: workspace.projectId,
    workspaceDir: workspace.workspaceDir,
  }
  const fromStage = options.fromStage ?? 'ingest'
  const stageIndex = resolveStageIndex(fromStage)
  const stages = STAGES.slice(stageIndex)
  const jobStore = createConfiguredJobStore({
    config,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    workspaceDir: workspace.workspaceDir,
  })

  await assertCheckpointArtifacts(workspace.projectId, workspace.workspaceDir, fromStage)
  await jobStore.initialize({
    inputPath,
    projectId: workspace.projectId,
    stages,
  })

  const output = await runPipeline<InitialStageInput, QualityOutput>(
    await hydratePipelineInput({
      artifacts,
      fromStage,
      inputPath,
      providers,
      workspace,
    }),
    createStageChain(fromStage, artifacts),
    {
      ...ctx,
      async emit(event: PipelineEvent) {
        await appendEvent(pipelineEventsPath, event)
        await updateJobStateFromEvent(jobStore, event)
        await options.onEvent?.(event)
      },
      retryPolicy: {
        backoffMs: config.pipeline.retryBackoffMs,
        maxRetries: config.pipeline.maxStageRetries,
      },
    },
  )
  const status = output.issues.some((issue) => issue.severity === 'error') ? 'failed' : 'completed'

  await jobStore.complete(status)
  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifacts: output.artifacts,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    status,
  }
}

async function updateJobStateFromEvent(jobStore: JobStore, event: PipelineEvent): Promise<void> {
  if (event.stage === undefined) {
    return
  }

  if (event.type === 'stage:start') {
    await jobStore.updateStage(event.stage, 'running', undefined, event.attempt)
    return
  }

  if (event.type === 'stage:complete') {
    await jobStore.updateStage(event.stage, 'completed', undefined, event.attempt)
    return
  }

  if (event.type === 'stage:fail') {
    await jobStore.updateStage(event.stage, 'failed', event.message, event.attempt)
  }
}

function createRuntimeProviderCallRecorder(path: string, onProviderCall: RunInitialPipelineOptions['onProviderCall'], onProviderCallStart: RunInitialPipelineOptions['onProviderCallStart']): ProviderCallRecorder {
  const jsonlRecorder = createJsonlProviderCallRecorder(path)

  return {
    async record(call) {
      await jsonlRecorder.record(call)
      await onProviderCall?.(call)
    },
    async start(call) {
      await onProviderCallStart?.(call)
    },
  }
}

function createStageChain(fromStage: InitialPipelineStage, artifacts: RunInitialPipelineResult['artifacts']): Stage<InitialStageInput, InitialStageOutput>[] {
  const stageIndex = resolveStageIndex(fromStage)

  return [
    createIngestStage(artifacts),
    createUnderstandStage(),
    createPlanStage(),
    createScriptStage(),
    createVoiceoverStage(),
    createQualityStage(),
  ].slice(stageIndex)
}

function resolveStageIndex(fromStage: InitialPipelineStage): number {
  const stageIndex = STAGES.indexOf(fromStage)

  if (stageIndex === -1) {
    throw new Error(`Unknown stage: ${fromStage}`)
  }

  return stageIndex
}

function createIngestStage(artifacts: RunInitialPipelineResult['artifacts']): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'ingest',
    async run(input, ctx) {
      const initial = input as InitialPipelineInput
      await emitStep(ctx, {data: {inputPath: initial.inputPath}, message: 'Probing source media.', stage: 'ingest', step: 'probe-media'})
      const mediaInfo = await probeMedia(initial.inputPath)
      const previewDuration = Math.min(mediaInfo.duration ?? 10, 10)
      const framePattern = join(initial.workspace.framesDir, 'frame_%05d.jpg')

      await emitStep(ctx, {data: summarizeMediaInfo(mediaInfo), message: 'Media probe completed.', stage: 'ingest', step: 'probe-media'})
      await emitStep(ctx, {data: {framePattern}, message: 'Extracting analysis frames.', stage: 'ingest', step: 'extract-frames'})
      await mkdir(initial.workspace.framesDir, {recursive: true})
      await extractFrames(initial.inputPath, framePattern)
      await emitStep(ctx, {data: {duration: previewDuration, outputPath: artifacts.preview}, message: 'Creating preview render.', stage: 'ingest', step: 'create-preview'})
      await createPreview(initial.inputPath, artifacts.preview, previewDuration)
      await emitArtifact(ctx, 'ingest', artifacts.preview, 'video')

      const nextArtifacts = {
        ...artifacts,
        frames: framePattern,
      }

      if (mediaInfo.streams.some((stream) => stream.type === 'audio')) {
        nextArtifacts.sourceAudio = join(initial.workspace.audioDir, 'source.wav')
        await emitStep(ctx, {data: {outputPath: nextArtifacts.sourceAudio}, message: 'Extracting source audio for ASR.', stage: 'ingest', step: 'extract-audio'})
        await extractAudio(initial.inputPath, nextArtifacts.sourceAudio)
        await emitArtifact(ctx, 'ingest', nextArtifacts.sourceAudio, 'audio')
      } else {
        await emitStep(ctx, {level: 'warn', message: 'Source has no audio stream; ASR will use media input directly.', stage: 'ingest', step: 'extract-audio'})
      }

      const ingestReport = {
        artifacts: nextArtifacts,
        completedAt: new Date().toISOString(),
        inputPath: initial.inputPath,
        stage: 'ingest',
        version: 1,
      }

      await initial.workspace.store.writeJson('media-info.json', MediaInfoSchema.parse(mediaInfo))
      await emitArtifact(ctx, 'ingest', artifacts.mediaInfo, 'json')
      await initial.workspace.store.writeJson('ingest-report.json', ingestReport)
      await emitArtifact(ctx, 'ingest', artifacts.ingestReport, 'json')

      return {
        ...initial,
        artifacts: nextArtifacts,
        mediaInfo,
      }
    },
  }
}

function createUnderstandStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'understand',
    async run(input, ctx) {
      const ingest = input as IngestOutput
      const asrInputPath = ingest.artifacts.sourceAudio ?? ingest.inputPath
      await emitStep(ctx, {data: {inputPath: asrInputPath, providerInput: ingest.artifacts.sourceAudio === undefined ? 'media' : 'audio'}, message: 'Transcribing source audio.', stage: 'understand', step: 'asr'})
      const transcript = TranscriptSchema.parse(await ingest.providers.asr.transcribe({
        path: asrInputPath,
      }))
      await emitStep(ctx, {data: summarizeTranscriptForLog(transcript), message: 'Transcript completed.', stage: 'understand', step: 'asr'})
      const sceneBatches = createSceneFrameBatchesFromTranscript(transcript, ingest.mediaInfo, ingest.artifacts.frames)
      await emitStep(ctx, {data: summarizeSceneBatchesForLog(sceneBatches), message: 'Analyzing visual scene batches.', stage: 'understand', step: 'vlm'})
      const sceneAnalysis = VlmScenesSchema.parse(await ingest.providers.vlm.analyzeScenes(sceneBatches))
      await emitStep(ctx, {data: summarizeVlmScenesForLog(sceneAnalysis), message: 'Visual scene analysis completed.', stage: 'understand', step: 'vlm'})

      await ingest.workspace.store.writeJson('transcript.json', transcript)
      await emitArtifact(ctx, 'understand', ingest.artifacts.transcript, 'json')
      await ingest.workspace.store.writeJson('scene-analysis.json', sceneAnalysis)
      await emitArtifact(ctx, 'understand', ingest.artifacts.sceneAnalysis, 'json')

      return {
        ...ingest,
        sceneAnalysis,
        transcript,
      }
    },
  }
}

export function createSceneFrameBatchesFromTranscript(transcript: Transcript, mediaInfo: MediaInfo, framePattern?: string): SceneFrameBatch[] {
  const frames = framePattern === undefined ? [] : [framePattern]

  return createSceneBoundariesFromTranscript(transcript, mediaInfo.duration ?? 0).map((boundary): SceneFrameBatch => ({
    frames,
    sceneId: boundary.id,
    timeRange: [boundary.start, boundary.end],
  }))
}

function createPlanStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'plan',
    async run(input, ctx) {
      const understood = input as UnderstandOutput
      await emitStep(ctx, {
        data: {
          scenes: understood.sceneAnalysis.length,
          transcriptSegments: understood.transcript.segments.length,
        },
        message: 'Creating storyboard.',
        stage: 'plan',
        step: 'storyboard',
      })
      const storyboard = StoryboardSchema.parse(await understood.providers.storyboard.createStoryboard({
        mediaInfo: understood.mediaInfo,
        sceneAnalysis: understood.sceneAnalysis,
        transcript: understood.transcript,
      }))
      await emitStep(ctx, {data: {storyboardScenes: storyboard.scenes.length}, message: 'Creating clip plan and timeline.', stage: 'plan', step: 'clip-plan'})
      const clipPlan = ClipPlanSchema.parse(createClipPlan(storyboard, understood.mediaInfo))
      const timeline = TimelineSchema.parse(createTimelineFromClipPlan(understood.mediaInfo, clipPlan))
      await emitStep(ctx, {
        data: {
          clips: clipPlan.clips.length,
          timelineItems: timeline.items.length,
        },
        message: 'Plan completed.',
        stage: 'plan',
        step: 'timeline',
      })

      await understood.workspace.store.writeJson('clip-plan.json', clipPlan)
      await emitArtifact(ctx, 'plan', understood.artifacts.clipPlan, 'json')
      await understood.workspace.store.writeJson('storyboard.json', StoryboardSchema.parse(storyboard))
      await emitArtifact(ctx, 'plan', understood.artifacts.storyboard, 'json')
      await understood.workspace.store.writeJson('timeline.json', timeline)
      await emitArtifact(ctx, 'plan', understood.artifacts.timeline, 'json')

      return {
        ...understood,
        clipPlan,
        storyboard,
        timeline,
      }
    },
  }
}

function createScriptStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'script',
    async run(input, ctx) {
      const planned = input as PlanOutput
      await emitStep(ctx, {
        data: {
          clips: planned.clipPlan.clips.length,
          storyboardScenes: planned.storyboard.scenes.length,
        },
        message: 'Creating narration script.',
        stage: 'script',
        step: 'narration',
      })
      const narration = NarrationSchema.parse(await planned.providers.script.createNarration({
        clipPlan: planned.clipPlan,
        storyboard: planned.storyboard,
      }))
      await emitStep(ctx, {data: summarizeNarrationForLog(narration), message: 'Narration completed.', stage: 'script', step: 'narration'})

      await planned.workspace.store.writeJson('narration.json', narration)
      await emitArtifact(ctx, 'script', planned.artifacts.narration, 'json')

      return {
        ...planned,
        narration,
      }
    },
  }
}

function createVoiceoverStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'voiceover',
    async run(input, ctx) {
      const scripted = input as ScriptOutput
      await emitStep(ctx, {data: summarizeNarrationForLog(scripted.narration), message: 'Synthesizing voiceover manifest.', stage: 'voiceover', step: 'tts'})
      const ttsSegments = TtsSegmentsSchema.parse(await scripted.providers.tts.synthesize(scripted.narration.segments))
      await emitStep(ctx, {data: summarizeTtsSegmentsForLog(ttsSegments), message: 'Voiceover manifest completed.', stage: 'voiceover', step: 'tts'})

      await scripted.workspace.store.writeJson('tts-segments.json', ttsSegments)
      await emitArtifact(ctx, 'voiceover', scripted.artifacts.ttsSegments, 'json')

      return {
        ...scripted,
        ttsSegments,
      }
    },
  }
}

function createQualityStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'quality',
    async run(input, ctx) {
      const voiced = input as VoiceoverOutput
      await emitStep(ctx, {
        data: {
          clips: voiced.clipPlan.clips.length,
          narrationSegments: voiced.narration.segments.length,
          ttsSegments: voiced.ttsSegments.length,
        },
        message: 'Running quality checks.',
        stage: 'quality',
        step: 'checks',
      })
      const issues = [
        ...checkStoryboardConsistency(voiced.storyboard, voiced.mediaInfo),
        ...checkClipPlanConsistency(voiced.clipPlan, voiced.timeline),
        ...checkTimelineBounds(voiced.timeline),
        ...checkNarrationTiming(voiced.narration, voiced.timeline),
        ...checkTtsCoverage(voiced.narration, voiced.ttsSegments),
      ]
      const qualityReport = {
        checkedAt: new Date().toISOString(),
        issues,
        narrationSegments: voiced.narration.segments.length,
        summary: summarizeQualityIssues(issues),
        ttsSegments: voiced.ttsSegments.length,
        version: 1,
      }
      await emitStep(ctx, {
        data: {
          issueCodes: issues.map((issue) => issue.code),
          ...qualityReport.summary,
        },
        level: qualityReport.summary.errors > 0 ? 'error' : qualityReport.summary.warnings > 0 ? 'warn' : 'info',
        message: 'Quality checks completed.',
        stage: 'quality',
        step: 'checks',
      })

      await voiced.workspace.store.writeJson('quality-report.json', qualityReport)
      await emitArtifact(ctx, 'quality', voiced.artifacts.qualityReport, 'json')

      return {
        ...voiced,
        issues,
      }
    },
  }
}

interface RuntimeStepEvent {
  data?: Record<string, unknown>
  level?: PipelineEvent['level']
  message: string
  stage: InitialPipelineStage
  step: string
}

async function emitStep(ctx: PipelineContext, event: RuntimeStepEvent): Promise<void> {
  await ctx.emit({
    data: event.data ?? {},
    level: event.level ?? 'info',
    message: event.message,
    projectId: ctx.projectId,
    stage: event.stage,
    step: event.step,
    time: new Date().toISOString(),
    type: 'log',
  })
}

async function emitArtifact(ctx: PipelineContext, stage: InitialPipelineStage, path: string, kind: ArtifactRef['kind']): Promise<void> {
  await ctx.emit({
    artifact: {
      kind,
      path,
    },
    level: 'debug',
    message: `Artifact written: ${path}`,
    projectId: ctx.projectId,
    stage,
    step: 'artifact',
    time: new Date().toISOString(),
    type: 'artifact',
  })
}

function summarizeMediaInfo(mediaInfo: MediaInfo): Record<string, unknown> {
  const video = mediaInfo.streams.find((stream) => stream.type === 'video')
  const audioStreams = mediaInfo.streams.filter((stream) => stream.type === 'audio')

  return {
    ...(mediaInfo.bitrate === undefined ? {} : {bitrate: mediaInfo.bitrate}),
    ...(mediaInfo.duration === undefined ? {} : {duration: mediaInfo.duration}),
    ...(mediaInfo.formatName === undefined ? {} : {format: mediaInfo.formatName}),
    ...(mediaInfo.size === undefined ? {} : {size: mediaInfo.size}),
    audioStreams: audioStreams.length,
    streams: mediaInfo.streams.length,
    ...(video?.fps === undefined ? {} : {fps: video.fps}),
    ...(video?.height === undefined ? {} : {height: video.height}),
    ...(video?.width === undefined ? {} : {width: video.width}),
  }
}

function summarizeTranscriptForLog(transcript: Transcript): Record<string, unknown> {
  let duration = 0

  for (const segment of transcript.segments) {
    duration = Math.max(duration, segment.end)
  }

  return {
    ...(transcript.language === undefined ? {} : {language: transcript.language}),
    duration,
    segments: transcript.segments.length,
    textLength: transcript.text.length,
  }
}

function summarizeSceneBatchesForLog(sceneBatches: SceneFrameBatch[]): Record<string, unknown> {
  let frames = 0

  for (const batch of sceneBatches) {
    frames += batch.frames.length
  }

  return {
    frames,
    scenes: sceneBatches.length,
  }
}

function summarizeVlmScenesForLog(scenes: VLMScene[]): Record<string, unknown> {
  let evidence = 0

  for (const scene of scenes) {
    evidence += scene.evidence.length
  }

  return {
    evidence,
    scenes: scenes.length,
  }
}

function summarizeNarrationForLog(narration: Narration): Record<string, unknown> {
  let duration = 0
  let textLength = 0

  for (const segment of narration.segments) {
    duration += segment.duration ?? 0
    textLength += segment.text.length
  }

  return {
    duration,
    segments: narration.segments.length,
    textLength,
  }
}

function summarizeTtsSegmentsForLog(segments: TTSSegment[]): Record<string, unknown> {
  let duration = 0

  for (const segment of segments) {
    duration += segment.duration
  }

  return {
    duration,
    segments: segments.length,
  }
}

function summarizeQualityIssues(issues: QualityIssue[]): {errors: number; warnings: number} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

interface HydratePipelineInputOptions {
  artifacts: RunInitialPipelineResult['artifacts']
  fromStage: InitialPipelineStage
  inputPath: string
  providers: PipelineProviders
  workspace: ProjectWorkspace
}

async function hydratePipelineInput(options: HydratePipelineInputOptions): Promise<InitialStageInput> {
  const {artifacts, fromStage, inputPath, providers, workspace} = options

  if (fromStage === 'ingest') {
    return {
      inputPath,
      providers,
      workspace,
    }
  }

  const ingestReport = await workspace.store.readJson<{artifacts?: Partial<RunInitialPipelineResult['artifacts']>}>('ingest-report.json')
  const ingest: IngestOutput = {
    artifacts: {
      ...artifacts,
      ...ingestReport.artifacts,
    },
    inputPath,
    mediaInfo: MediaInfoSchema.parse(await workspace.store.readJson('media-info.json')),
    providers,
    workspace,
  }

  if (fromStage === 'understand') {
    return ingest
  }

  const understood: UnderstandOutput = {
    ...ingest,
    sceneAnalysis: VlmScenesSchema.parse(await workspace.store.readJson('scene-analysis.json')),
    transcript: TranscriptSchema.parse(await workspace.store.readJson('transcript.json')),
  }

  if (fromStage === 'plan') {
    return understood
  }

  const planned: PlanOutput = {
    ...understood,
    clipPlan: ClipPlanSchema.parse(await workspace.store.readJson('clip-plan.json')),
    storyboard: StoryboardSchema.parse(await workspace.store.readJson('storyboard.json')),
    timeline: TimelineSchema.parse(await workspace.store.readJson('timeline.json')),
  }

  if (fromStage === 'script') {
    return planned
  }

  const scripted: ScriptOutput = {
    ...planned,
    narration: NarrationSchema.parse(await workspace.store.readJson('narration.json')),
  }

  if (fromStage === 'voiceover') {
    return scripted
  }

  return {
    ...scripted,
    ttsSegments: TtsSegmentsSchema.parse(await workspace.store.readJson('tts-segments.json')),
  }
}

export async function assertCheckpointArtifacts(projectId: string, workspaceDir: string, fromStage: InitialPipelineStage): Promise<void> {
  const workspace = await createProjectWorkspace({
    projectId,
    workspaceDir,
  })
  const requiredArtifacts = CHECKPOINT_ARTIFACTS_BY_STAGE[fromStage]

  if (requiredArtifacts.length === 0) {
    return
  }

  const missing = (
    await Promise.all(
      requiredArtifacts.map(async (artifact) => {
        const exists = await bunFile(workspace.store.resolve(artifact)).exists()

        return exists ? null : artifact
      }),
    )
  ).filter((artifact): artifact is string => artifact !== null)

  const integrity = await verifyProjectArtifacts(workspace.projectId, workspace.workspaceDir)
  const required = new Set(requiredArtifacts)
  const changedArtifacts = integrity.changed.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const missingManifestArtifacts = integrity.missing.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const schemaInvalidArtifacts = integrity.schemaInvalid.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const untrackedArtifacts = integrity.untracked.filter((artifact) => required.has(artifact))
  const missingArtifacts = [...new Set([...missing, ...missingManifestArtifacts])]

  if (missingArtifacts.length > 0 || changedArtifacts.length > 0 || schemaInvalidArtifacts.length > 0 || untrackedArtifacts.length > 0) {
    throw new PipelineCheckpointError(fromStage, {
      changedArtifacts,
      missingArtifacts,
      schemaInvalidArtifacts,
      untrackedArtifacts,
    })
  }
}

async function appendEvent(path: string, event: PipelineEvent): Promise<void> {
  const artifact = event.type === 'artifact' ? event.artifact : undefined

  await appendFile(path, `${JSON.stringify({...event, artifact: normalizeArtifact(artifact)})}\n`)
}

function normalizeArtifact(artifact: ArtifactRef | undefined): ArtifactRef | undefined {
  return artifact
}

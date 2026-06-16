import type {PipelineContext, PipelineEvent, Stage} from '@video-agent/core'
import type {JobStore} from '@video-agent/db'
import type {ArtifactRef, ClipPlan, LongVideoChapterSummaries, LongVideoChunk, LongVideoChunkPlan, LongVideoChunkSilence, LongVideoChunkSummaries, LongVideoChunkSummary, LongVideoGlobalOutline, LongVideoMoment, LongVideoSelectedMoments, MediaInfo, Narration, Storyboard, Timeline} from '@video-agent/ir'
import type {LLMClient} from '@video-agent/llm'
import type {ProviderSet, SceneFrameBatch, Transcript, TTSSegment, VLMScene} from '@video-agent/providers'

import {createClipPlan, createLongVideoChunkPlan, createSceneBoundariesFromTranscript, createTimelineFromClipPlan, runPipeline} from '@video-agent/core'
import {ClipPlanSchema, LongVideoAnalysisFramesSchema, LongVideoChapterSummariesSchema, LongVideoChunkPlanSchema, LongVideoChunkSilenceSchema, LongVideoChunkSummariesSchema, LongVideoChunkSummarySchema, LongVideoGlobalOutlineSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, StoryboardSchema, TimelineSchema} from '@video-agent/ir'
import {createLLMClientFromConfig} from '@video-agent/llm'
import {createPreview, extractAudio, extractAudioSegment, extractFrames, probeMedia} from '@video-agent/media'
import {createProviders, SceneFrameBatchesSchema, TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {checkClipPlanConsistency, checkNarrationTiming, checkStoryboardConsistency, checkTimelineBounds, checkTtsCoverage, type QualityIssue} from '@video-agent/quality'
import {appendFile, mkdir, readdir} from 'node:fs/promises'
import {basename, dirname, join, resolve} from 'node:path'

import {ARTIFACT_MANIFEST_NAME, refreshArtifactManifest} from './artifact-store.js'
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
    analysisFrames?: string
    clipPlan: string
    chapters: string
    chunkPlan: string
    chunkSummaries: string
    frames?: string
    globalOutline: string
    ingestReport: string
    mediaInfo: string
    narration: string
    pipelineEvents: string
    preview: string
    providerCalls: string
    qualityReport: string
    sceneAnalysis: string
    sceneBatches: string
    selectedMoments: string
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
  chunkPlan: LongVideoChunkPlan
  mediaInfo: MediaInfo
}

interface UnderstandOutput extends IngestOutput {
  chapters: LongVideoChapterSummaries
  chunkSummaries: LongVideoChunkSummaries
  globalOutline: LongVideoGlobalOutline
  sceneAnalysis: VLMScene[]
  selectedMoments: LongVideoSelectedMoments
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
const ANALYSIS_FRAME_FPS = 1

const CHECKPOINT_ARTIFACTS_BY_STAGE: Record<InitialPipelineStage, readonly string[]> = {
  ingest: [],
  plan: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json'],
  quality: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json', 'storyboard.json', 'clip-plan.json', 'timeline.json', 'narration.json', 'tts-segments.json'],
  script: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json', 'storyboard.json', 'clip-plan.json', 'timeline.json'],
  understand: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json'],
  voiceover: ['ingest-report.json', 'media-info.json', 'chunk-plan.json', 'frames.json', 'scene-analysis.json', 'scene-batches.json', 'transcript.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json', 'storyboard.json', 'clip-plan.json', 'timeline.json', 'narration.json'],
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
    analysisFrames: workspace.store.resolve('frames.json'),
    chapters: workspace.store.resolve('chapters.json'),
    chunkPlan: workspace.store.resolve('chunk-plan.json'),
    chunkSummaries: workspace.store.resolve('chunk-summaries.json'),
    clipPlan: workspace.store.resolve('clip-plan.json'),
    globalOutline: workspace.store.resolve('global-outline.json'),
    ingestReport: workspace.store.resolve('ingest-report.json'),
    mediaInfo: workspace.store.resolve('media-info.json'),
    narration: workspace.store.resolve('narration.json'),
    pipelineEvents: pipelineEventsPath,
    preview: join(workspace.rendersDir, 'preview.mp4'),
    providerCalls: providerCallsPath,
    qualityReport: workspace.store.resolve('quality-report.json'),
    sceneAnalysis: workspace.store.resolve('scene-analysis.json'),
    sceneBatches: workspace.store.resolve('scene-batches.json'),
    selectedMoments: workspace.store.resolve('selected-moments.json'),
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
      const hasVideo = mediaInfo.streams.some((stream) => stream.type === 'video')
      const previewDuration = Math.min(mediaInfo.duration ?? 10, 10)
      const framePattern = join(initial.workspace.framesDir, 'frame_%05d.jpg')

      await emitStep(ctx, {data: summarizeMediaInfo(mediaInfo), message: 'Media probe completed.', stage: 'ingest', step: 'probe-media'})

      if (!hasVideo) {
        throw new Error('Source media must include a video stream for the initial video pipeline.')
      }

      const chunkPlan = LongVideoChunkPlanSchema.parse(createLongVideoChunkPlan(mediaInfo))
      await emitStep(ctx, {data: {framePattern}, message: 'Extracting analysis frames.', stage: 'ingest', step: 'extract-frames'})
      await mkdir(initial.workspace.framesDir, {recursive: true})
      await extractFrames(initial.inputPath, framePattern, chunkPlan.defaults.frameSampleFps)
      const analysisFrames = await listExtractedAnalysisFrames(framePattern, chunkPlan.defaults.frameSampleFps)
      const analysisFramesPath = artifacts.analysisFrames ?? initial.workspace.store.resolve('frames.json')

      await initial.workspace.store.writeJson('frames.json', LongVideoAnalysisFramesSchema.parse({
        frameCount: analysisFrames.length,
        framePattern,
        frames: analysisFrames,
        sampleFps: chunkPlan.defaults.frameSampleFps,
        source: initial.inputPath,
        version: 1,
      }))
      await emitArtifact(ctx, 'ingest', analysisFramesPath, 'json')
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
      await initial.workspace.store.writeJson('chunk-plan.json', chunkPlan)
      await emitArtifact(ctx, 'ingest', artifacts.chunkPlan, 'json')
      await initial.workspace.store.writeJson('ingest-report.json', ingestReport)
      await emitArtifact(ctx, 'ingest', artifacts.ingestReport, 'json')

      return {
        ...initial,
        artifacts: nextArtifacts,
        chunkPlan,
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
      const transcript = await transcribeSourceAudio(ingest, ctx)
      await emitProgress(ctx, {
        current: transcript.segments.length,
        message: 'ASR transcript segments completed.',
        stage: 'understand',
        step: 'asr',
        unit: 'segments',
      })
      await emitStep(ctx, {data: summarizeTranscriptForLog(transcript), message: 'Transcript completed.', stage: 'understand', step: 'asr'})
      const analysisFrames = await readAnalysisFrames(ingest)
      const sceneBatches = createSceneFrameBatchesFromTranscript(transcript, ingest.mediaInfo, analysisFrames.length > 0 ? analysisFrames : ingest.artifacts.frames, {
        maxFramesPerBatch: ingest.chunkPlan.defaults.vlmBatchSize,
        mediaDuration: ingest.chunkPlan.sourceDuration,
        sampleFps: ingest.chunkPlan.defaults.vlmFrameSampleFps,
        sceneDetection: ingest.chunkPlan.defaults.sceneDetection,
      })
      await emitStep(ctx, {data: summarizeSceneBatchesForLog(sceneBatches), message: 'Analyzing visual scene batches.', stage: 'understand', step: 'vlm'})
      const sceneAnalysis = await analyzeSceneBatches(ingest, sceneBatches, ctx)
      await emitStep(ctx, {data: summarizeVlmScenesForLog(sceneAnalysis), message: 'Visual scene analysis completed.', stage: 'understand', step: 'vlm'})

      const longVideoArtifacts = createLongVideoUnderstandingArtifacts(ingest.chunkPlan, transcript, sceneAnalysis, sceneBatches)

      await ingest.workspace.store.writeJson('transcript.json', transcript)
      await emitArtifact(ctx, 'understand', ingest.artifacts.transcript, 'json')
      await ingest.workspace.store.writeJson('scene-batches.json', SceneFrameBatchesSchema.parse(sceneBatches))
      await emitArtifact(ctx, 'understand', ingest.artifacts.sceneBatches, 'json')
      await ingest.workspace.store.writeJson('scene-analysis.json', sceneAnalysis)
      await emitArtifact(ctx, 'understand', ingest.artifacts.sceneAnalysis, 'json')
      await ingest.workspace.store.writeJson('chunk-summaries.json', longVideoArtifacts.chunkSummaries)
      await emitArtifact(ctx, 'understand', ingest.artifacts.chunkSummaries, 'json')
      await Promise.all(longVideoArtifacts.chunkArtifacts.flatMap((chunkArtifact) => [
        ingest.workspace.store.writeJson(`${chunkArtifact.prefix}/summary.json`, chunkArtifact.summary),
        ingest.workspace.store.writeJson(`${chunkArtifact.prefix}/silence.json`, chunkArtifact.silence),
        ingest.workspace.store.writeJson(`${chunkArtifact.prefix}/transcript.json`, chunkArtifact.transcript),
        ingest.workspace.store.writeJson(`${chunkArtifact.prefix}/vlm.json`, chunkArtifact.vlm),
      ]))
      await Promise.all(longVideoArtifacts.chunkArtifacts.flatMap((chunkArtifact) => [
        emitArtifact(ctx, 'understand', ingest.workspace.store.resolve(`${chunkArtifact.prefix}/summary.json`), 'json'),
        emitArtifact(ctx, 'understand', ingest.workspace.store.resolve(`${chunkArtifact.prefix}/silence.json`), 'json'),
        emitArtifact(ctx, 'understand', ingest.workspace.store.resolve(`${chunkArtifact.prefix}/transcript.json`), 'json'),
        emitArtifact(ctx, 'understand', ingest.workspace.store.resolve(`${chunkArtifact.prefix}/vlm.json`), 'json'),
      ]))
      await ingest.workspace.store.writeJson('chapters.json', longVideoArtifacts.chapters)
      await emitArtifact(ctx, 'understand', ingest.artifacts.chapters, 'json')
      await ingest.workspace.store.writeJson('global-outline.json', longVideoArtifacts.globalOutline)
      await emitArtifact(ctx, 'understand', ingest.artifacts.globalOutline, 'json')
      await ingest.workspace.store.writeJson('selected-moments.json', longVideoArtifacts.selectedMoments)
      await emitArtifact(ctx, 'understand', ingest.artifacts.selectedMoments, 'json')

      return {
        ...ingest,
        chapters: longVideoArtifacts.chapters,
        chunkSummaries: longVideoArtifacts.chunkSummaries,
        globalOutline: longVideoArtifacts.globalOutline,
        sceneAnalysis,
        selectedMoments: longVideoArtifacts.selectedMoments,
        transcript,
      }
    },
  }
}

export async function transcribeSourceAudio(ingest: IngestOutput, ctx: PipelineContext): Promise<Transcript> {
  const asrInputPath = ingest.artifacts.sourceAudio ?? ingest.inputPath

  if (!shouldChunkAsr(ingest)) {
    return TranscriptSchema.parse(await ingest.providers.asr.transcribe({
      ...(ingest.mediaInfo.duration === undefined ? {} : {duration: ingest.mediaInfo.duration}),
      path: asrInputPath,
    }))
  }

  const transcripts: Transcript[] = []
  let completedChunks = 0

  await emitStep(ctx, {
    data: {
      chunks: ingest.chunkPlan.chunks.length,
      sourceAudio: ingest.artifacts.sourceAudio,
    },
    message: 'Transcribing source audio chunks.',
    stage: 'understand',
    step: 'asr-chunks',
  })

  /* eslint-disable no-await-in-loop */
  for (const chunk of ingest.chunkPlan.chunks) {
    const cachedTranscript = await readCachedChunkTranscript(ingest, chunk)

    if (cachedTranscript !== undefined) {
      await emitStep(ctx, {
        data: {
          chunkId: chunk.id,
          transcriptSegments: cachedTranscript.segments.length,
        },
        level: 'debug',
        message: 'Reusing cached chunk transcript.',
        stage: 'understand',
        step: 'asr-chunks',
      })
      transcripts.push(cachedTranscript)
      completedChunks += 1
      await emitProgress(ctx, {
        current: completedChunks,
        message: 'ASR audio chunks completed.',
        stage: 'understand',
        step: 'asr-chunks',
        total: ingest.chunkPlan.chunks.length,
        unit: 'chunks',
      })
      continue
    }

    const chunkAudioPath = join(ingest.workspace.audioDir, 'asr', `${String(chunk.index).padStart(3, '0')}.wav`)
    const analysisDuration = chunk.analysisRange[1] - chunk.analysisRange[0]

    await mkdir(dirname(chunkAudioPath), {recursive: true})
    await extractAudioSegment(ingest.artifacts.sourceAudio as string, chunkAudioPath, chunk.analysisRange[0], analysisDuration)
    const analysisTranscript = offsetChunkTranscript(TranscriptSchema.parse(await ingest.providers.asr.transcribe({
      duration: analysisDuration,
      path: chunkAudioPath,
    })), chunk.analysisRange)

    const chunkTranscript = createChunkTranscript(analysisTranscript, chunk.contentRange)

    await ingest.workspace.store.writeJson(`${chunk.artifactPrefix}/transcript.json`, chunkTranscript)
    await emitArtifact(ctx, 'understand', ingest.workspace.store.resolve(`${chunk.artifactPrefix}/transcript.json`), 'json')
    transcripts.push(chunkTranscript)
    completedChunks += 1
    await emitProgress(ctx, {
      current: completedChunks,
      message: 'ASR audio chunks completed.',
      stage: 'understand',
      step: 'asr-chunks',
      total: ingest.chunkPlan.chunks.length,
      unit: 'chunks',
    })
  }
  /* eslint-enable no-await-in-loop */

  return mergeChunkTranscripts(transcripts)
}

export async function analyzeSceneBatches(ingest: IngestOutput, sceneBatches: SceneFrameBatch[], ctx: PipelineContext): Promise<VLMScene[]> {
  const cachedSceneAnalysis = await readReusableSceneAnalysis(ingest, sceneBatches)
  const missingSceneBatches = sceneBatches.filter((batch) => cachedSceneAnalysis.get(batch.sceneId) === undefined)

  if (missingSceneBatches.length === 0) {
    await emitStep(ctx, {
      data: {
        scenes: cachedSceneAnalysis.size,
      },
      level: 'debug',
      message: 'Reusing cached visual scene analysis.',
      stage: 'understand',
      step: 'vlm',
    })
    await emitProgress(ctx, {
      current: sceneBatches.length,
      message: 'VLM scene batches completed from cache.',
      stage: 'understand',
      step: 'vlm',
      total: sceneBatches.length,
      unit: 'scenes',
    })
    return validateVlmSceneAnalysis(sceneBatches, sceneBatches.map((batch) => cachedSceneAnalysis.get(batch.sceneId) as VLMScene))
  }

  if (cachedSceneAnalysis.size > 0) {
    await emitProgress(ctx, {
      current: cachedSceneAnalysis.size,
      message: 'VLM scene batches reused from cache.',
      stage: 'understand',
      step: 'vlm',
      total: sceneBatches.length,
      unit: 'scenes',
    })
    await emitStep(ctx, {
      data: {
        cachedScenes: cachedSceneAnalysis.size,
        scenesToAnalyze: missingSceneBatches.length,
      },
      level: 'debug',
      message: 'Reusing cached visual scene analysis for unchanged scenes.',
      stage: 'understand',
      step: 'vlm',
    })
  }

  const freshSceneAnalysis = validateVlmSceneAnalysis(missingSceneBatches, VlmScenesSchema.parse(await ingest.providers.vlm.analyzeScenes(missingSceneBatches)))
  await emitProgress(ctx, {
    current: cachedSceneAnalysis.size + freshSceneAnalysis.length,
    message: 'VLM scene batches completed.',
    stage: 'understand',
    step: 'vlm',
    total: sceneBatches.length,
    unit: 'scenes',
  })
  const freshBySceneId = new Map(freshSceneAnalysis.map((scene) => [scene.sceneId, scene]))
  const mergedSceneAnalysis = sceneBatches.map((batch) => cachedSceneAnalysis.get(batch.sceneId) ?? freshBySceneId.get(batch.sceneId))

  return validateVlmSceneAnalysis(sceneBatches, mergedSceneAnalysis.map((scene, index) => {
    if (scene === undefined) {
      throw new Error(`VLM provider did not return analysis for sceneId ${JSON.stringify(sceneBatches[index]?.sceneId)}.`)
    }

    return scene
  }))
}

async function readReusableSceneAnalysis(ingest: IngestOutput, sceneBatches: SceneFrameBatch[]): Promise<Map<string, VLMScene>> {
  if (!await bunFile(ingest.workspace.store.resolve('scene-analysis.json')).exists()) {
    return new Map()
  }

  if (!await bunFile(ingest.workspace.store.resolve('scene-batches.json')).exists()) {
    return new Map()
  }

  try {
    const cachedSceneBatches = SceneFrameBatchesSchema.parse(await ingest.workspace.store.readJson('scene-batches.json'))
    const cachedSceneAnalysis = validateVlmSceneAnalysis(cachedSceneBatches, VlmScenesSchema.parse(await ingest.workspace.store.readJson('scene-analysis.json')))
    const reusable = new Map<string, VLMScene>()

    for (const batch of sceneBatches) {
      const cachedIndex = cachedSceneBatches.findIndex((cachedBatch) => sceneBatchEqual(cachedBatch, batch))
      const cachedScene = cachedIndex === -1 ? undefined : cachedSceneAnalysis[cachedIndex]

      if (cachedScene !== undefined) {
        reusable.set(batch.sceneId, cachedScene)
      }
    }

    return reusable
  } catch {
    return new Map()
  }
}

function sceneBatchEqual(left: SceneFrameBatch, right: SceneFrameBatch): boolean {
  return left.sceneId === right.sceneId &&
    left.timeRange[0] === right.timeRange[0] &&
    left.timeRange[1] === right.timeRange[1] &&
    stringArraysEqual(left.frames, right.frames)
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function readCachedChunkTranscript(ingest: IngestOutput, chunk: LongVideoChunk): Promise<Transcript | undefined> {
  const artifactName = `${chunk.artifactPrefix}/transcript.json`

  if (!await bunFile(ingest.workspace.store.resolve(artifactName)).exists()) {
    return undefined
  }

  try {
    return createChunkTranscript(TranscriptSchema.parse(await ingest.workspace.store.readJson(artifactName)), chunk.contentRange)
  } catch {
    return undefined
  }
}

async function readAnalysisFrames(ingest: IngestOutput): Promise<ExtractedAnalysisFrame[]> {
  if (ingest.artifacts.analysisFrames !== undefined && await bunFile(ingest.artifacts.analysisFrames).exists()) {
    try {
      return LongVideoAnalysisFramesSchema.parse(await ingest.workspace.store.readJson('frames.json')).frames
    } catch {
      return []
    }
  }

  return listExtractedAnalysisFrames(ingest.artifacts.frames, ingest.chunkPlan.defaults.frameSampleFps)
}

function shouldChunkAsr(ingest: IngestOutput): boolean {
  return ingest.chunkPlan.defaults.asrChunking && ingest.artifacts.sourceAudio !== undefined && ingest.chunkPlan.chunks.length > 1
}

export function mergeChunkTranscripts(transcripts: Transcript[]): Transcript {
  const language = transcripts.find((transcript) => transcript.language !== undefined)?.language
  const segments = transcripts.flatMap((transcript) => transcript.segments).sort((left, right) => left.start - right.start || left.end - right.end)
  const text = [...transcripts]
    .sort((left, right) => transcriptStart(left) - transcriptStart(right))
    .map((transcript) => transcript.text.trim())
    .filter(Boolean)
    .join('\n')

  return TranscriptSchema.parse({
    ...(language === undefined ? {} : {language}),
    segments,
    text,
    timestampConfidence: 'chunked',
  })
}

function transcriptStart(transcript: Transcript): number {
  return transcript.segments.reduce((start, segment) => Math.min(start, segment.start), Number.POSITIVE_INFINITY)
}

export function offsetChunkTranscript(transcript: Transcript, range: [number, number]): Transcript {
  const [chunkStart, chunkEnd] = range
  const segments = transcript.segments
    .map((segment) => ({
      ...segment,
      end: clampTime(chunkStart + segment.end, chunkStart, chunkEnd),
      start: clampTime(chunkStart + segment.start, chunkStart, chunkEnd),
    }))
    .filter((segment) => segment.end >= segment.start)
  const hasTimedSegment = segments.some((segment) => segment.end > segment.start)

  return TranscriptSchema.parse({
    ...(transcript.language === undefined ? {} : {language: transcript.language}),
    segments: hasTimedSegment || transcript.text.trim() === ''
      ? segments
      : [{
          end: chunkEnd,
          start: chunkStart,
          text: transcript.text,
        }],
    text: transcript.text,
    timestampConfidence: 'chunked',
  })
}

function clampTime(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export interface ExtractedAnalysisFrame {
  path: string
  timestamp: number
}

export interface SceneFrameBatchOptions {
  maxFramesPerBatch?: number
  mediaDuration?: number
  sampleFps?: number
  sceneDetection?: boolean
}

export function createSceneFrameBatchesFromTranscript(transcript: Transcript, mediaInfo: MediaInfo, frameSource?: ExtractedAnalysisFrame[] | string, options: SceneFrameBatchOptions = {}): SceneFrameBatch[] {
  const boundaries = createSceneBatchBoundaries(transcript, options.mediaDuration ?? mediaInfo.duration ?? 0, options.sceneDetection)

  return boundaries.map((boundary): SceneFrameBatch => ({
    frames: selectSceneFramePaths(frameSource, boundary.start, boundary.end, options),
    sceneId: boundary.id,
    timeRange: [boundary.start, boundary.end],
  }))
}

function createSceneBatchBoundaries(transcript: Transcript, mediaDuration: number, sceneDetection = true): Array<{end: number; id: string; start: number}> {
  const boundaries = createSceneBoundariesFromTranscript(transcript, mediaDuration)

  if (sceneDetection) {
    return boundaries
  }

  const end = boundaries.reduce((duration, boundary) => Math.max(duration, boundary.end), 0)

  return [
    {
      end,
      id: 'scene-1',
      start: 0,
    },
  ]
}

export function validateVlmSceneAnalysis(sceneBatches: SceneFrameBatch[], sceneAnalysis: VLMScene[]): VLMScene[] {
  if (sceneAnalysis.length !== sceneBatches.length) {
    throw new Error(`VLM provider returned ${sceneAnalysis.length} scene(s), expected ${sceneBatches.length}.`)
  }

  for (const [index, batch] of sceneBatches.entries()) {
    const scene = sceneAnalysis[index]

    if (scene?.sceneId !== batch.sceneId) {
      throw new Error(`VLM provider returned sceneId ${JSON.stringify(scene?.sceneId)} at index ${index}, expected ${JSON.stringify(batch.sceneId)}.`)
    }
  }

  return sceneAnalysis
}

async function listExtractedAnalysisFrames(framePattern: string | undefined, fps: number): Promise<ExtractedAnalysisFrame[]> {
  if (framePattern === undefined) {
    return []
  }

  const parsed = parseFfmpegFramePattern(framePattern)

  if (parsed === undefined) {
    return []
  }

  let entries: string[]

  try {
    entries = await readdir(parsed.directory)
  } catch {
    return []
  }

  const frames = entries
    .map((entry) => parseExtractedFrame(entry, parsed))
    .filter((frame): frame is {index: number; path: string} => frame !== undefined)
    .sort((a, b) => a.index - b.index)

  const firstIndex = frames[0]?.index

  if (firstIndex === undefined) {
    return []
  }

  return frames.map((frame) => ({
    path: frame.path,
    timestamp: (frame.index - firstIndex) / fps,
  }))
}

function selectSceneFramePaths(frameSource: ExtractedAnalysisFrame[] | string | undefined, start: number, end: number, options: SceneFrameBatchOptions): string[] {
  if (frameSource === undefined) {
    return []
  }

  if (typeof frameSource === 'string') {
    return [frameSource]
  }

  const selected = frameSource
    .filter((frame) => frame.timestamp >= start && frame.timestamp < end)
  const sampled = sampleAnalysisFramesForVlm(selected, start, options).map((frame) => frame.path)

  if (sampled.length > 0) {
    return sampled
  }

  const fallback = frameSource.find((frame) => frame.timestamp >= start) ?? frameSource.at(-1)

  return fallback === undefined ? [] : [fallback.path]
}

function sampleAnalysisFramesForVlm(frames: ExtractedAnalysisFrame[], start: number, options: SceneFrameBatchOptions): ExtractedAnalysisFrame[] {
  const maxFrames = normalizePositiveInteger(options.maxFramesPerBatch)
  const sampleFps = normalizePositiveNumber(options.sampleFps)

  let sampled = frames

  if (sampleFps !== undefined) {
    const minSpacingSeconds = 1 / sampleFps
    let lastTimestamp = Number.NEGATIVE_INFINITY

    sampled = frames.filter((frame) => {
      if (frame.timestamp - Math.max(start, lastTimestamp) + 1e-9 < minSpacingSeconds && lastTimestamp !== Number.NEGATIVE_INFINITY) {
        return false
      }

      lastTimestamp = frame.timestamp
      return true
    })
  }

  if (maxFrames !== undefined && sampled.length > maxFrames) {
    sampled = sampleEvenly(sampled, maxFrames)
  }

  return sampled
}

function sampleEvenly<T>(values: T[], limit: number): T[] {
  if (values.length <= limit) {
    return values
  }

  if (limit === 1) {
    const first = values[0]

    return first === undefined ? [] : [first]
  }

  const lastIndex = values.length - 1

  return Array.from({length: limit}, (_, index) => values[Math.round((index * lastIndex) / (limit - 1))])
    .filter((value): value is T => value !== undefined)
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  return value === undefined || !Number.isInteger(value) || value <= 0 ? undefined : value
}

function normalizePositiveNumber(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? undefined : value
}

interface ParsedFramePattern {
  directory: string
  pattern: RegExp
}

function parseFfmpegFramePattern(framePattern: string): ParsedFramePattern | undefined {
  const fileName = basename(framePattern)
  const match = /^(.*)%0?\d*d(.*)$/.exec(fileName)

  if (match === null) {
    return undefined
  }

  const [, prefix, suffix] = match

  return {
    directory: dirname(framePattern),
    pattern: new RegExp(`^${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}$`),
  }
}

function parseExtractedFrame(entry: string, parsed: ParsedFramePattern): {index: number; path: string} | undefined {
  const match = parsed.pattern.exec(entry)

  if (match?.[1] === undefined) {
    return undefined
  }

  return {
    index: Number(match[1]),
    path: join(parsed.directory, entry),
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface LongVideoUnderstandingArtifacts {
  chapters: LongVideoChapterSummaries
  chunkArtifacts: LongVideoChunkArtifact[]
  chunkSummaries: LongVideoChunkSummaries
  globalOutline: LongVideoGlobalOutline
  selectedMoments: LongVideoSelectedMoments
}

interface LongVideoChunkArtifact {
  prefix: string
  silence: LongVideoChunkSilence
  summary: LongVideoChunkSummary
  transcript: Transcript
  vlm: VLMScene[]
}

function createLongVideoUnderstandingArtifacts(chunkPlan: LongVideoChunkPlan, transcript: Transcript, sceneAnalysis: VLMScene[], sceneBatches: SceneFrameBatch[]): LongVideoUnderstandingArtifacts {
  const sceneRanges = sceneBatches.map((batch) => ({
    end: batch.timeRange[1],
    start: batch.timeRange[0],
  }))
  const chunkArtifacts = chunkPlan.chunks.map((chunk): LongVideoChunkArtifact => {
    const chunkTranscript = createChunkTranscript(transcript, chunk.contentRange)
    const chunkVlm = createChunkVlmScenes(sceneAnalysis, sceneRanges, chunk.analysisRange)
    const transcriptSummary = summarizeTranscript(chunkTranscript)
    const visualSummary = summarizeVisualScenes(chunkVlm)
    const keyMoment = createChunkMoment(chunk.id, chunk.contentRange, chunk.artifactPrefix, transcriptSummary, visualSummary)
    const silenceRanges = createSilenceRanges(chunkTranscript, chunk.contentRange)
    const silence = LongVideoChunkSilenceSchema.parse({
      chunkId: chunk.id,
      contentRange: chunk.contentRange,
      silenceRanges,
      version: 1,
    })
    const summary = LongVideoChunkSummarySchema.parse({
      chunkId: chunk.id,
      contentRange: chunk.contentRange,
      keyMoments: [keyMoment],
      silenceRanges,
      summary: summarizeChunk(chunk.id, chunk.contentRange, transcriptSummary, visualSummary),
      ...(transcriptSummary === undefined ? {} : {transcriptSummary}),
      ...(visualSummary === undefined ? {} : {visualSummary}),
    })

    return {
      prefix: chunk.artifactPrefix,
      silence,
      summary,
      transcript: chunkTranscript,
      vlm: chunkVlm,
    }
  })
  const chunkSummaries = LongVideoChunkSummariesSchema.parse({
    chunks: chunkArtifacts.map((artifact) => artifact.summary),
    source: chunkPlan.source,
    version: 1,
  })
  const chapters = LongVideoChapterSummariesSchema.parse({
    chapters: chunkSummaries.chunks.map((chunkSummary, index) => ({
      chunkIds: [chunkSummary.chunkId],
      evidence: chunkSummary.keyMoments.flatMap((moment) => moment.evidence),
      id: `chapter-${String(index + 1).padStart(3, '0')}`,
      index,
      keyMoments: chunkSummary.keyMoments,
      sourceRange: chunkSummary.contentRange,
      summary: chunkSummary.summary,
      title: `Chapter ${index + 1}`,
    })),
    source: chunkPlan.source,
    version: 1,
  })
  const globalOutline = LongVideoGlobalOutlineSchema.parse({
    chapters: chapters.chapters,
    language: transcript.language ?? 'zh-CN',
    source: chunkPlan.source,
    sourceDuration: chunkPlan.sourceDuration,
    storyBeats: chapters.chapters.map((chapter, index) => ({
      chapterIds: [chapter.id],
      evidence: chapter.evidence,
      id: `beat-${String(index + 1).padStart(3, '0')}`,
      sourceRange: chapter.sourceRange,
      summary: chapter.summary,
      title: chapter.title,
    })),
    version: 1,
  })
  const selectedMoments = LongVideoSelectedMomentsSchema.parse({
    moments: chunkSummaries.chunks.flatMap((chunkSummary) => chunkSummary.keyMoments.map((moment) => ({
      ...moment,
      chunkId: chunkSummary.chunkId,
      reason: 'Deterministic initial selection from chunk summary.',
    }))),
    source: chunkPlan.source,
    version: 1,
  })

  return {
    chapters,
    chunkArtifacts,
    chunkSummaries,
    globalOutline,
    selectedMoments,
  }
}

export function createChunkTranscript(transcript: Transcript, range: [number, number]): Transcript {
  const [start, end] = range
  const segments = transcript.segments
    .filter((segment) => rangesOverlap([segment.start, segment.end], range))
    .map((segment) => ({
      ...segment,
      end: clampTime(segment.end, start, end),
      start: clampTime(segment.start, start, end),
    }))
    .filter((segment) => segment.end > segment.start)

  return TranscriptSchema.parse({
    ...(transcript.language === undefined ? {} : {language: transcript.language}),
    segments,
    text: segments.map((segment) => segment.text).join('\n'),
    ...(transcript.timestampConfidence === undefined ? {} : {timestampConfidence: transcript.timestampConfidence}),
  })
}

export function createSilenceRanges(transcript: Transcript, range: [number, number]): Array<[number, number]> {
  const [start, end] = range
  const segments = transcript.segments
    .map((segment) => ({
      end: clampTime(segment.end, start, end),
      start: clampTime(segment.start, start, end),
    }))
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const silenceRanges: Array<[number, number]> = []
  let cursor = start

  for (const segment of segments) {
    if (segment.start > cursor) {
      silenceRanges.push([cursor, segment.start])
    }

    cursor = Math.max(cursor, segment.end)
  }

  if (cursor < end) {
    silenceRanges.push([cursor, end])
  }

  return silenceRanges
}

export function createChunkVlmScenes(sceneAnalysis: VLMScene[], sceneRanges: Array<{end: number; start: number}>, range: [number, number]): VLMScene[] {
  const scenes = sceneAnalysis.filter((_, index) => {
    const sceneRange = sceneRanges[index]

    return sceneRange === undefined ? sceneAnalysis.length === 1 : rangesOverlap([sceneRange.start, sceneRange.end], range)
  })

  return VlmScenesSchema.parse(scenes)
}

function summarizeTranscript(transcript: Transcript): string | undefined {
  return normalizeText(transcript.text)
}

function summarizeVisualScenes(sceneAnalysis: VLMScene[]): string | undefined {
  const descriptions = sceneAnalysis.map((scene) => scene.description.trim()).filter(Boolean)

  return descriptions.length === 0 ? undefined : descriptions.slice(0, 3).join(' ')
}

function createChunkMoment(chunkId: string, range: [number, number], artifactPrefix: string, transcriptSummary: string | undefined, visualSummary: string | undefined): LongVideoMoment {
  return {
    chunkId,
    evidence: [
      ...(transcriptSummary === undefined ? [] : [{ref: `${artifactPrefix}/transcript.json`, text: transcriptSummary, type: 'asr' as const}]),
      ...(visualSummary === undefined ? [] : [{ref: `${artifactPrefix}/vlm.json`, text: visualSummary, type: 'vlm' as const}]),
    ],
    id: `${chunkId}-moment-001`,
    score: 0.5,
    sourceRange: range,
    summary: transcriptSummary ?? visualSummary ?? `Content from ${formatRange(range)}.`,
    title: `Moment ${chunkId}`,
  }
}

function summarizeChunk(chunkId: string, range: [number, number], transcriptSummary: string | undefined, visualSummary: string | undefined): string {
  const details = [transcriptSummary, visualSummary].filter((value): value is string => value !== undefined)

  return details.length === 0 ? `${chunkId} covers ${formatRange(range)}.` : `${chunkId} covers ${formatRange(range)}. ${details.join(' ')}`
}

function rangesOverlap(left: [number, number], right: [number, number]): boolean {
  return left[0] < right[1] && right[0] < left[1]
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim()

  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

function formatRange(range: [number, number]): string {
  return `${formatSecond(range[0])}-${formatSecond(range[1])}s`
}

function formatSecond(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function createLongVideoPlanningContext(understood: UnderstandOutput) {
  return {
    chapters: understood.chapters,
    chunkPlan: understood.chunkPlan,
    chunkSummaries: understood.chunkSummaries,
    globalOutline: understood.globalOutline,
    selectedMoments: understood.selectedMoments,
  }
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
        longVideo: createLongVideoPlanningContext(understood),
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
        longVideo: createLongVideoPlanningContext(planned),
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
      const ttsSegments = TtsSegmentsSchema.parse(await scripted.providers.tts.synthesize(scripted.narration.segments, {
        outputDir: join(scripted.workspace.audioDir, 'tts'),
        pathPrefix: 'audio/tts',
      }))
      await emitProgress(ctx, {
        current: ttsSegments.length,
        message: 'TTS segments completed.',
        stage: 'voiceover',
        step: 'tts',
        total: scripted.narration.segments.length,
        unit: 'segments',
      })
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
      await emitProgress(ctx, {
        current: 5,
        message: 'Quality check groups completed.',
        stage: 'quality',
        step: 'checks',
        total: 5,
      })
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

interface RuntimeProgressEvent {
  current?: number
  message?: string
  percent?: number
  stage: InitialPipelineStage
  step?: string
  total?: number
  unit?: PipelineEvent['unit']
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

async function emitProgress(ctx: PipelineContext, event: RuntimeProgressEvent): Promise<void> {
  await ctx.emit({
    current: event.current,
    level: 'info',
    message: event.message,
    percent: normalizePercent(event),
    projectId: ctx.projectId,
    stage: event.stage,
    step: event.step,
    time: new Date().toISOString(),
    total: event.total,
    type: 'stage:progress',
    unit: event.unit,
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

function normalizePercent(event: RuntimeProgressEvent): number | undefined {
  if (event.percent !== undefined) {
    return clampPercent(event.percent)
  }

  if (event.current === undefined || event.total === undefined || event.total <= 0) {
    return undefined
  }

  return clampPercent((event.current / event.total) * 100)
}

function clampPercent(percent: number): number | undefined {
  if (!Number.isFinite(percent)) {
    return undefined
  }

  return Math.min(100, Math.max(0, percent))
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
    ...(transcript.timestampConfidence === undefined ? {} : {timestampConfidence: transcript.timestampConfidence}),
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
    chunkPlan: LongVideoChunkPlanSchema.parse(await workspace.store.readJson('chunk-plan.json')),
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
    chapters: LongVideoChapterSummariesSchema.parse(await workspace.store.readJson('chapters.json')),
    chunkSummaries: LongVideoChunkSummariesSchema.parse(await workspace.store.readJson('chunk-summaries.json')),
    globalOutline: LongVideoGlobalOutlineSchema.parse(await workspace.store.readJson('global-outline.json')),
    sceneAnalysis: VlmScenesSchema.parse(await workspace.store.readJson('scene-analysis.json')),
    selectedMoments: LongVideoSelectedMomentsSchema.parse(await workspace.store.readJson('selected-moments.json')),
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
  const checkpointArtifacts = CHECKPOINT_ARTIFACTS_BY_STAGE[fromStage]

  if (checkpointArtifacts.length === 0) {
    return
  }

  const requiredArtifacts = [
    ...checkpointArtifacts,
    ...await readDynamicCheckpointArtifacts(workspace, checkpointArtifacts),
    ARTIFACT_MANIFEST_NAME,
  ]
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
  const missingSideArtifacts = await findMissingCheckpointSideArtifacts(workspace, checkpointArtifacts)
  const missingArtifacts = [...new Set([...missing, ...missingManifestArtifacts, ...missingSideArtifacts])]

  if (missingArtifacts.length > 0 || changedArtifacts.length > 0 || schemaInvalidArtifacts.length > 0 || untrackedArtifacts.length > 0) {
    throw new PipelineCheckpointError(fromStage, {
      changedArtifacts,
      missingArtifacts,
      schemaInvalidArtifacts,
      untrackedArtifacts,
    })
  }
}

async function readDynamicCheckpointArtifacts(workspace: ProjectWorkspace, checkpointArtifacts: readonly string[]): Promise<string[]> {
  if (!checkpointArtifacts.includes('chunk-summaries.json')) {
    return []
  }

  let chunkPlan: LongVideoChunkPlan

  try {
    chunkPlan = LongVideoChunkPlanSchema.parse(await workspace.store.readJson('chunk-plan.json'))
  } catch {
    return []
  }

  return chunkPlan.chunks.flatMap((chunk) => [
    `${chunk.artifactPrefix}/summary.json`,
    `${chunk.artifactPrefix}/silence.json`,
    `${chunk.artifactPrefix}/transcript.json`,
    `${chunk.artifactPrefix}/vlm.json`,
  ])
}

async function findMissingCheckpointSideArtifacts(workspace: ProjectWorkspace, checkpointArtifacts: readonly string[]): Promise<string[]> {
  if (!checkpointArtifacts.includes('ingest-report.json')) {
    return []
  }

  let ingestReport: {artifacts?: Partial<RunInitialPipelineResult['artifacts']>}

  try {
    ingestReport = await workspace.store.readJson('ingest-report.json')
  } catch {
    return []
  }

  const missing: string[] = []

  if (ingestReport.artifacts?.sourceAudio !== undefined && !await bunFile(ingestReport.artifacts.sourceAudio).exists()) {
    missing.push(formatCheckpointPath(workspace, ingestReport.artifacts.sourceAudio))
  }

  if (ingestReport.artifacts?.preview !== undefined && !await bunFile(ingestReport.artifacts.preview).exists()) {
    missing.push(formatCheckpointPath(workspace, ingestReport.artifacts.preview))
  }

  if (ingestReport.artifacts?.frames !== undefined && !await hasExtractedAnalysisFrames(ingestReport.artifacts.frames)) {
    missing.push(formatCheckpointPath(workspace, ingestReport.artifacts.frames))
  }

  missing.push(...await findMissingAnalysisFrameFiles(workspace, checkpointArtifacts))

  return missing
}

async function findMissingAnalysisFrameFiles(workspace: ProjectWorkspace, checkpointArtifacts: readonly string[]): Promise<string[]> {
  if (!checkpointArtifacts.includes('frames.json') || !await bunFile(workspace.store.resolve('frames.json')).exists()) {
    return []
  }

  try {
    const manifest = LongVideoAnalysisFramesSchema.parse(await workspace.store.readJson('frames.json'))
    const missing = await Promise.all(manifest.frames.map(async (frame) => await bunFile(frame.path).exists() ? null : formatCheckpointPath(workspace, frame.path)))

    return missing.filter((path): path is string => path !== null)
  } catch {
    return []
  }
}

async function hasExtractedAnalysisFrames(framePattern: string): Promise<boolean> {
  return (await listExtractedAnalysisFrames(framePattern, ANALYSIS_FRAME_FPS)).length > 0
}

function formatCheckpointPath(workspace: ProjectWorkspace, path: string): string {
  const normalizedProjectDir = `${workspace.projectDir}/`

  return path.startsWith(normalizedProjectDir) ? path.slice(normalizedProjectDir.length) : path
}

async function appendEvent(path: string, event: PipelineEvent): Promise<void> {
  const artifact = event.type === 'artifact' ? event.artifact : undefined

  await appendFile(path, `${JSON.stringify({...event, artifact: normalizeArtifact(artifact)})}\n`)
}

function normalizeArtifact(artifact: ArtifactRef | undefined): ArtifactRef | undefined {
  return artifact
}

import type {Claim, Claims, ContentBlock, Deck, DeckFormat, DeckQualityIssue, DeckQualityReport, DeckSlideQualityMetrics, DeckSlideType, DeckVisual, Document, LongVideoSelectedMoments, MediaInfo, MotionTimeline, Narration, Outline, Slide, SlideTiming, SourceQuote, SourceQuotes, SpeakerScript, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {LLMClient, LLMTraceRecorder} from '@video-agent/llm'
import type {TTSSegment} from '@video-agent/providers'
import type {QualityIssue, SubtitleQualityResult, VisualFrameSample, VisualSmokeQualityResult} from '@video-agent/quality'
import type {CaptureDeckHtmlFrameSequenceResult, CaptureDeckHtmlKeyframesResult, DeckHtmlFrameSequenceCaptureBackend, DeckHtmlFrameSequenceFrame, DeckHtmlKeyframeCaptureBackend} from '@video-agent/renderer-html'
import type {HyperframesCliResult} from '@video-agent/renderer-hyperframes'
import type {MotionCanvasDeckProject} from '@video-agent/renderer-motion-canvas'
import type {RemotionDeckProject, RemotionRenderCliResult, RemotionRenderMediaResult} from '@video-agent/renderer-remotion'

import {JsonJobStore} from '@video-agent/db'
import {ClaimsSchema, ContentBlocksSchema, DeckQualityReportSchema, DeckSchema, DocumentSchema, MediaInfoSchema, NarrationSchema, OutlineSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'
import {createJsonlLLMTraceRecorder} from '@video-agent/llm'
import {probeMedia, runFfmpeg} from '@video-agent/media'
import {TranscriptSchema, TtsSegmentsSchema} from '@video-agent/providers'
import {checkExplainerStructure, checkNarrationTiming, checkRenderedMedia, checkSrtSubtitles, checkStoryboardConsistency, checkTimelineBounds, checkVisualSmoke, createRenderedMediaProbeFailure} from '@video-agent/quality'
import {compileDeckMotionPlan, deckCanvasSize, deckTemplateManifestForLLM, findDeckTemplateManifestEntry, isDeckTemplateType, maxPointsForDeckTemplate, resolveMotionStepsForTemplate, validateSlideAgainstTemplateManifest, writeDeckHtmlProject} from '@video-agent/renderer-deck'
import {narrationToSrt, narrationToSrtCues} from '@video-agent/renderer-ffmpeg'
import {captureDeckHtmlFrameSequence, captureDeckHtmlKeyframes, createDeckHtmlFrameSequence, selectDeckHtmlKeyframes} from '@video-agent/renderer-html'
import {renderHyperframesProject, validateHyperframesProject} from '@video-agent/renderer-hyperframes'
import {writeMotionCanvasDeckProject} from '@video-agent/renderer-motion-canvas'
import {renderRemotionDeckMedia, renderRemotionDeckProject, writeRemotionDeckProject} from '@video-agent/renderer-remotion'
import {createHash} from 'node:crypto'
import {mkdir, readdir, rm, stat} from 'node:fs/promises'
import {extname, isAbsolute, join, resolve} from 'node:path'
import {z} from 'zod'

import {refreshArtifactManifest} from './artifact-store.js'
import {bunFile, bunWrite} from './bun-runtime.js'
import {readConfig} from './config.js'
import {assertFileExists} from './file-io.js'
import {DECK_PIPELINE_DEFINITION} from './pipeline-definitions.js'
import {createRuntimeLLMClient, createRuntimeProviders} from './runtime-providers.js'
import {createProjectWorkspace, type ProjectWorkspace} from './workspace.js'

export interface CreateDeckExplainerProjectOptions {
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  inputPath: string
  language?: string
  llmClient?: LLMClient
  maxSlideCharacters?: number
  mode?: 'script-generated'
  projectId?: string
  slideSeconds?: number
  theme?: string
  title?: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateDeckExplainerProjectResult {
  artifacts: {
    contentBlocks: string
    claims: string
    deck: string
    document: string
    llmTrace?: string
    mediaInfo: string
    narration: string
    outline: string
    qualityReport: string
    selectedMoments: string
    speakerScript: string
    sourceQuotes: string
    storyboard: string
    timedDeck: string
    timeline: string
  }
  projectDir: string
  projectId: string
  slides: number
  status: 'completed'
}

export interface CreateDeckVoiceoverProjectOptions {
  projectId: string
  trace?: boolean
  workspaceDir?: string
}

export interface DeckVoiceoverSegment {
  duration: number
  narrationId: string
  path: string
  slideId: string
  start: number
}

export interface DeckVoiceover {
  duration: number
  generatedAt: string
  outputPath: string
  segments: DeckVoiceoverSegment[]
  version: 1
}

export interface CreateDeckVoiceoverProjectResult {
  artifacts: {
    deckVoiceover: string
    llmTrace?: string
    mediaInfo: string
    narration: string
    qualityReport: string
    selectedMoments: string
    storyboard: string
    timedDeck: string
    timeline: string
    ttsSegments: string
  }
  duration: number
  outputPath: string
  projectDir: string
  projectId: string
  slides: number
  status: 'voiced'
}

export interface CreateDeckFinalRenderProjectOptions {
  chromiumCommand?: string[]
  compositionId?: string
  frameCaptureBackend?: DeckHtmlFrameSequenceCaptureBackend
  frameConcurrency?: number
  frameEnd?: number
  frameStart?: number
  finalize?: boolean
  finalizeOnly?: boolean
  htmlOutput?: string
  htmlRender?: boolean
  htmlRenderCommand?: string[]
  htmlValidate?: boolean
  keyframeCaptureBackend?: DeckHtmlKeyframeCaptureBackend
  playwrightCommand?: string[]
  projectId: string
  renderer?: 'html' | 'remotion'
  workspaceDir?: string
}

export interface CreateDeckFinalRenderProjectResult {
  artifactPath: string
  audioPath: string
  deckQualityReportPath: string
  finalized: boolean
  frameEnd?: number
  frameManifestPath?: string
  frameRenderer?: DeckHtmlFrameSequenceCaptureBackend
  frameStart?: number
  frameCount?: number
  htmlEntryPath?: string
  htmlOutputDir?: string
  keyframeQualityPath?: string
  keyframeRenderer?: DeckHtmlKeyframeCaptureBackend
  outputPath: string
  projectDir: string
  projectId: string
  remotion?: RemotionRenderMediaResult
  renderer: 'html' | 'remotion'
  rendered?: HyperframesCliResult
  status: 'frames-rendered' | 'rendered'
  subtitleMuxed?: boolean
  subtitleMuxMode?: 'mov_text'
  subtitlePath?: string
  subtitleQuality?: SubtitleQualityResult
  validation?: HyperframesCliResult
  videoRenderer: 'chromium+ffmpeg' | 'playwright+ffmpeg' | 'remotion+ffmpeg'
  visualQuality?: VisualSmokeQualityResult
}

export interface CreateDeckFrameShardPlanProjectOptions {
  frameCaptureBackend?: DeckHtmlFrameSequenceCaptureBackend
  frameShardSize?: number
  projectId: string
  workspaceDir?: string
}

export interface DeckFrameShardPlanShard {
  commandArgs: string[]
  existingFrames: number
  frameCount: number
  frameEnd: number
  frameStart: number
  missingFrameSamples: Array<{frame: number; path: string}>
  missingFrames: number
  shardArtifactPath: string
  status: 'complete' | 'partial' | 'pending'
}

export interface CreateDeckFrameShardPlanProjectResult {
  artifactPath: string
  completeShards: number
  duration: number
  finalizeArgs: string[]
  frameCount: number
  frameShardSize: number
  partialShards: number
  pendingShards: number
  projectDir: string
  projectId: string
  shardCount: number
  shards: DeckFrameShardPlanShard[]
  status: 'planned'
}

export interface CreateDeckFrameShardBatchProjectOptions {
  chromiumCommand?: string[]
  frameCaptureBackend?: DeckHtmlFrameSequenceCaptureBackend
  frameConcurrency?: number
  frameShardSize?: number
  playwrightCommand?: string[]
  projectId: string
  shardConcurrency?: number
  shardRetryDelayMs?: number
  shardRetries?: number
  workspaceDir?: string
}

export interface DeckFrameShardBatchShard {
  artifactPath?: string
  attempts: number
  capturedFrames: number
  error?: string
  frameCount: number
  frameEnd: number
  frameStart: number
  skippedFrames: number
  status: 'complete' | 'failed'
}

export interface CreateDeckFrameShardBatchProjectResult {
  artifactPath: string
  completedShards: number
  failedShards: number
  frameCapturedCount: number
  frameConcurrency: number
  frameCount: number
  frameManifestPath: string
  frameShardSize: number
  frameSkippedCount: number
  htmlEntryPath: string
  htmlOutputDir: string
  projectDir: string
  projectId: string
  renderer: DeckHtmlFrameSequenceCaptureBackend
  shardConcurrency: number
  shardCount: number
  shardRetryDelayMs: number
  shardRetries: number
  shards: DeckFrameShardBatchShard[]
  status: 'completed' | 'partial'
}

export type DeckRendererBackend = 'motion-canvas' | 'remotion'

export interface CreateDeckRendererBackendProjectOptions {
  backend: DeckRendererBackend
  compositionId?: string
  fps?: number
  outputDir?: string
  projectId: string
  workspaceDir?: string
}

export interface CreateDeckRendererBackendProjectResult {
  artifactPath: string
  backend: DeckRendererBackend
  commandCwd: string
  files: Record<string, string>
  fps: number
  height?: number
  motionTimelinePath: string
  outputDir: string
  previewCommand: string[]
  projectDir: string
  projectId: string
  renderCommand: string[]
  sourceSha256: string
  status: 'exported'
  width?: number
}

export interface CreateDeckRemotionRenderProjectOptions extends Omit<CreateDeckRendererBackendProjectOptions, 'backend'> {
  command?: string[]
  outputPath?: string
}

export interface CreateDeckRemotionRenderProjectResult {
  artifactPath: string
  backend: 'remotion'
  command: string[]
  commandCwd: string
  exportArtifactPath: string
  outputPath: string
  projectDir: string
  projectId: string
  rendered: RemotionRenderCliResult
  rendererProjectDir: string
  sourceSha256: string
  status: 'rendered'
}

export interface CreateDeckAudioAnchoredProjectOptions {
  deckFormat?: DeckFormat
  inputPath: string
  language?: string
  llmClient?: LLMClient
  maxSlideCharacters?: number
  projectId?: string
  slideSeconds?: number
  theme?: string
  title?: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateDeckAudioAnchoredProjectResult {
  artifacts: {
    contentBlocks: string
    claims: string
    deck: string
    deckVoiceover: string
    document: string
    llmTrace?: string
    mediaInfo: string
    narration: string
    outline: string
    qualityReport: string
    selectedMoments: string
    speakerScript: string
    sourceQuotes: string
    storyboard: string
    timedDeck: string
    timeline: string
    transcript: string
  }
  duration: number
  outputPath: string
  projectDir: string
  projectId: string
  slides: number
  status: 'completed'
}

export interface CreateDeckAudioSummaryProjectResult extends CreateDeckExplainerProjectResult {
  artifacts: CreateDeckExplainerProjectResult['artifacts'] & {
    transcript: string
  }
  sourceMode: 'audio-summary'
}

export type CreateDeckSummarizeProjectOptions = Omit<CreateDeckExplainerProjectOptions, 'mode'>
export type CreateDeckSummarizeProjectResult = CreateDeckExplainerProjectResult | CreateDeckAudioSummaryProjectResult

const DEFAULT_MAX_SLIDE_CHARACTERS = 260
const DEFAULT_SLIDE_SECONDS = 18
const DEFAULT_DECK_FRAME_CONCURRENCY = 1
const DEFAULT_DECK_RENDER_FPS = 30
const DEFAULT_DECK_FRAME_SHARD_SIZE = 300
const DEFAULT_DECK_THEME: Deck['theme'] = 'elegant-dark'
const DECK_THEMES = ['auto', 'elegant-dark', 'clean-white', 'finance-terminal', 'tech-gradient', 'minimal-editorial', 'warm-paper', 'custom'] as const
const DECK_THEME_DESCRIPTIONS: Record<string, string> = {
  'elegant-dark': '深色科技风，适合技术、AI、数据、编程主题',
  'clean-white': '简洁白净，适合商业汇报、教育、通用主题',
  'finance-terminal': '终端绿色风，适合金融、加密货币、数据终端主题',
  'tech-gradient': '蓝紫渐变，适合前沿科技、创新、未来感主题',
  'minimal-editorial': '暖色纸张风，适合人文、编辑、出版、学术主题',
  'warm-paper': '暖橙纸张风，适合生活、文化、温暖、故事性主题',
}
const DECK_AUDIO_ANCHORED_STAGES = ['ingest', 'transcribe', 'plan', 'align', 'quality'] as const
const DECK_SUMMARIZE_STAGES = ['ingest', 'transcribe', 'understand', 'plan', 'script', 'quality'] as const
const DECK_STAGES = ['ingest', 'understand', 'plan', 'script', 'synthesize-voice', 'update-timing', 'render-final', 'quality'] as const
const LLM_TRACE_ARTIFACT_NAME = 'llm-traces.jsonl'

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
  renderer: z.enum(['chromium', 'playwright']),
  skippedFrames: z.number().int().nonnegative().optional(),
  sourceSha256: z.string().min(1),
  viewport: z.object({
    height: z.number().int().positive(),
    width: z.number().int().positive(),
  }).strict(),
}).passthrough()
type ReusableDeckFrameManifest = z.infer<typeof DeckFrameManifestReuseSchema>

interface ProjectLLMTrace {
  path?: string
  recorder?: LLMTraceRecorder
}

interface TextDeckProjectPlan {
  claims: Claims
  contentBlocks: {blocks: ContentBlock[]; version: 1}
  deck: Deck
  document: Document
  mediaInfo: MediaInfo
  narration: Narration
  outline: Outline
  qualityReport: {
    checkedAt: string
    issues: QualityIssue[]
    narrationSegments: number
    summary: {errors: number; warnings: number}
    ttsSegments: number
    version: 1
  }
  selectedMoments: LongVideoSelectedMoments
  sourceQuotes: SourceQuotes
  speakerScript: SpeakerScript
  storyboard: Storyboard
  timedDeck: TimedDeck
  timeline: Timeline
}

function createProjectLLMTrace(workspace: ProjectWorkspace, enabled: boolean | undefined): ProjectLLMTrace {
  if (enabled !== true) {
    return {}
  }

  const path = workspace.store.resolve(LLM_TRACE_ARTIFACT_NAME)

  return {
    path,
    recorder: createJsonlLLMTraceRecorder(path),
  }
}

function withLLMTracePath(error: unknown, tracePath: string | undefined): Error {
  const message = error instanceof Error ? error.message : String(error)
  const suffix = tracePath === undefined ? '' : `\nLLM trace: ${tracePath}`

  return new Error(`${message}${suffix}`, {
    cause: error,
  })
}

export async function createDeckExplainerProject(options: CreateDeckExplainerProjectOptions): Promise<CreateDeckExplainerProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const text = normalizeText(await bunFile(inputPath).text())

  if (text === '') {
    throw new Error('Text explainer input must not be empty.')
  }

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const llmTrace = createProjectLLMTrace(workspace, options.trace)
  const language = options.language ?? 'zh-CN'
  const config = await readConfig(workspace.workspaceDir)
  const llmClient = await createRuntimeLLMClient(config, workspace.workspaceDir, {
    llmClient: options.llmClient,
    llmTrace: llmTrace.recorder,
  })
  let plan: TextDeckProjectPlan

  try {
    if (llmClient === undefined) {
      throw new Error('Deck explainer planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
    }

    plan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      deckFormat: options.deckFormat,
      durationTargetSeconds: options.durationTargetSeconds,
      language,
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      slideSeconds: options.slideSeconds ?? DEFAULT_SLIDE_SECONDS,
      sourceType: inferDocumentSourceType(inputPath),
      theme: options.theme,
      title: options.title,
    })
  } catch (error) {
    throw withLLMTracePath(error, llmTrace.path)
  }
  const artifacts = {
    document: await workspace.store.writeJson('document.json', plan.document),
    contentBlocks: await workspace.store.writeJson('content-blocks.json', plan.contentBlocks),
    claims: await workspace.store.writeJson('claims.json', plan.claims),
    sourceQuotes: await workspace.store.writeJson('source-quotes.json', plan.sourceQuotes),
    outline: await workspace.store.writeJson('outline.json', plan.outline),
    deck: await workspace.store.writeJson('deck.json', plan.deck),
    speakerScript: await workspace.store.writeJson('speaker-script.json', plan.speakerScript),
    timedDeck: await workspace.store.writeJson('timed-deck.json', plan.timedDeck),
    mediaInfo: await workspace.store.writeJson('media-info.json', plan.mediaInfo),
    selectedMoments: await workspace.store.writeJson('selected-moments.json', plan.selectedMoments),
    storyboard: await workspace.store.writeJson('storyboard.json', plan.storyboard),
    timeline: await workspace.store.writeJson('timeline.json', plan.timeline),
    narration: await workspace.store.writeJson('narration.json', plan.narration),
    qualityReport: await workspace.store.writeJson('quality-report.json', plan.qualityReport),
    ...(llmTrace.path === undefined ? {} : {llmTrace: llmTrace.path}),
  }
  const jobStore = new JsonJobStore(resolve(workspace.projectDir, 'job-state.json'))

  await jobStore.initialize({
    inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId: workspace.projectId,
    stages: DECK_STAGES,
  })

  await ['ingest', 'understand', 'plan', 'script', 'quality'].reduce(
    async (previous, stage) => {
      await previous
      await jobStore.updateStage(stage, 'completed', undefined, 1)
    },
    Promise.resolve(),
  )

  await jobStore.complete('completed')
  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifacts,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    slides: plan.deck.slides.length,
    status: 'completed',
  }
}

export async function createDeckSummarizeProject(options: CreateDeckSummarizeProjectOptions): Promise<CreateDeckSummarizeProjectResult> {
  const inputPath = resolve(options.inputPath)

  if (!isAudioInputPath(inputPath)) {
    return createDeckExplainerProject({
      ...options,
      mode: 'script-generated',
    })
  }

  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const workspaceDir = workspace.workspaceDir
  const llmTrace = createProjectLLMTrace(workspace, options.trace)
  const jobStore = new JsonJobStore(resolve(workspace.projectDir, 'job-state.json'))

  await jobStore.initialize({
    inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId: workspace.projectId,
    stages: DECK_SUMMARIZE_STAGES,
  })
  await jobStore.updateStage('ingest', 'running', undefined, 1)

  try {
    const sourceMediaInfo = await probeMedia(inputPath)
    const sourceDuration = sourceMediaInfo.duration ?? DEFAULT_SLIDE_SECONDS
    const config = await readConfig(workspaceDir)
    const llmClient = await createRuntimeLLMClient(config, workspaceDir, {
      llmClient: options.llmClient,
      llmTrace: llmTrace.recorder,
    })

    if (llmClient === undefined) {
      throw new Error('Deck audio summary planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
    }

    const providers = await createRuntimeProviders(config, workspaceDir, {
      llmClient,
      llmTrace: llmTrace.recorder,
    })

    await jobStore.updateStage('ingest', 'completed', undefined, 1)
    await jobStore.updateStage('transcribe', 'running', undefined, 1)

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration: sourceDuration,
      path: inputPath,
    }))
    const text = normalizeText(transcript.text || transcript.segments.map((segment) => segment.text).join('\n\n'))

    if (text === '') {
      throw new Error('Deck summarize audio transcript must not be empty.')
    }

    await jobStore.updateStage('transcribe', 'completed', undefined, 1)
    await jobStore.updateStage('understand', 'running', undefined, 1)

    const language = options.language ?? transcript.language ?? 'zh-CN'
    const plan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      deckFormat: options.deckFormat,
      durationTargetSeconds: options.durationTargetSeconds,
      language,
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      slideSeconds: options.slideSeconds ?? DEFAULT_SLIDE_SECONDS,
      sourceType: 'audio',
      theme: options.theme,
      title: options.title,
    })

    await jobStore.updateStage('understand', 'completed', undefined, 1)
    await jobStore.updateStage('plan', 'running', undefined, 1)

    const artifacts = {
      transcript: await workspace.store.writeJson('transcript.json', transcript),
      document: await workspace.store.writeJson('document.json', plan.document),
      contentBlocks: await workspace.store.writeJson('content-blocks.json', plan.contentBlocks),
      claims: await workspace.store.writeJson('claims.json', plan.claims),
      sourceQuotes: await workspace.store.writeJson('source-quotes.json', plan.sourceQuotes),
      outline: await workspace.store.writeJson('outline.json', plan.outline),
      deck: await workspace.store.writeJson('deck.json', plan.deck),
      speakerScript: await workspace.store.writeJson('speaker-script.json', plan.speakerScript),
      timedDeck: await workspace.store.writeJson('timed-deck.json', plan.timedDeck),
      mediaInfo: await workspace.store.writeJson('media-info.json', plan.mediaInfo),
      selectedMoments: await workspace.store.writeJson('selected-moments.json', plan.selectedMoments),
      storyboard: await workspace.store.writeJson('storyboard.json', plan.storyboard),
      timeline: await workspace.store.writeJson('timeline.json', plan.timeline),
      narration: await workspace.store.writeJson('narration.json', plan.narration),
      qualityReport: await workspace.store.writeJson('quality-report.json', plan.qualityReport),
      ...(llmTrace.path === undefined ? {} : {llmTrace: llmTrace.path}),
    }

    await jobStore.updateStage('plan', 'completed', undefined, 1)
    await jobStore.updateStage('script', 'completed', undefined, 1)
    await jobStore.updateStage('quality', 'completed', undefined, 1)
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      slides: plan.deck.slides.length,
      sourceMode: 'audio-summary',
      status: 'completed',
    }
  } catch (error) {
    const tracedError = withLLMTracePath(error, llmTrace.path)
    await jobStore.updateStage('transcribe', 'failed', tracedError.message, 1)
    throw tracedError
  }
}

export async function createDeckAudioAnchoredProject(options: CreateDeckAudioAnchoredProjectOptions): Promise<CreateDeckAudioAnchoredProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const workspaceDir = workspace.workspaceDir
  const llmTrace = createProjectLLMTrace(workspace, options.trace)
  const jobStore = new JsonJobStore(resolve(workspace.projectDir, 'job-state.json'))

  await jobStore.initialize({
    inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId: workspace.projectId,
    stages: DECK_AUDIO_ANCHORED_STAGES,
  })
  await jobStore.updateStage('ingest', 'running', undefined, 1)

  try {
    const outputPath = resolve(workspace.audioDir, 'deck_voiceover.wav')

    await convertDeckSourceAudio(inputPath, outputPath)

    const mediaInfo = await probeMedia(outputPath)
    const duration = mediaInfo.duration ?? DEFAULT_SLIDE_SECONDS
    const config = await readConfig(workspaceDir)
    const llmClient = await createRuntimeLLMClient(config, workspaceDir, {
      llmClient: options.llmClient,
      llmTrace: llmTrace.recorder,
    })

    if (llmClient === undefined) {
      throw new Error('Deck audio-anchored planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
    }

    const providers = await createRuntimeProviders(config, workspaceDir, {
      llmClient,
      llmTrace: llmTrace.recorder,
    })

    await jobStore.updateStage('ingest', 'completed', undefined, 1)
    await jobStore.updateStage('transcribe', 'running', undefined, 1)

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration,
      path: inputPath,
    }))
    const language = options.language ?? transcript.language ?? 'zh-CN'
    const text = normalizeText(transcript.text || transcript.segments.map((segment) => segment.text).join('\n\n'))

    if (text === '') {
      throw new Error('Deck audio-anchored transcript must not be empty.')
    }

    await jobStore.updateStage('transcribe', 'completed', undefined, 1)
    await jobStore.updateStage('plan', 'running', undefined, 1)

    const generatedPlan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      deckFormat: options.deckFormat,
      durationTargetSeconds: duration,
      language,
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      slideSeconds: options.slideSeconds ?? DEFAULT_SLIDE_SECONDS,
      sourceType: 'audio',
      theme: options.theme,
      title: options.title,
    })
    const plan = createAudioAnchoredDeckProjectPlan(generatedPlan, inputPath, mediaInfo, duration, language, options.slideSeconds ?? DEFAULT_SLIDE_SECONDS)
    const deckVoiceover = {
      duration,
      generatedAt: new Date().toISOString(),
      outputPath: 'audio/deck_voiceover.wav',
      segments: plan.timedDeck.timings.map((timing, index) => ({
        duration: roundSeconds(timing.end - timing.start),
        narrationId: `narration-${index + 1}`,
        path: 'audio/deck_voiceover.wav',
        slideId: timing.slideId,
        start: timing.start,
      })),
      version: 1 as const,
    }
    const artifacts = {
      transcript: await workspace.store.writeJson('transcript.json', transcript),
      document: await workspace.store.writeJson('document.json', plan.document),
      contentBlocks: await workspace.store.writeJson('content-blocks.json', plan.contentBlocks),
      claims: await workspace.store.writeJson('claims.json', plan.claims),
      sourceQuotes: await workspace.store.writeJson('source-quotes.json', plan.sourceQuotes),
      outline: await workspace.store.writeJson('outline.json', plan.outline),
      deck: await workspace.store.writeJson('deck.json', plan.deck),
      speakerScript: await workspace.store.writeJson('speaker-script.json', plan.speakerScript),
      timedDeck: await workspace.store.writeJson('timed-deck.json', plan.timedDeck),
      deckVoiceover: await workspace.store.writeJson('deck-voiceover.json', deckVoiceover),
      mediaInfo: await workspace.store.writeJson('media-info.json', plan.mediaInfo),
      selectedMoments: await workspace.store.writeJson('selected-moments.json', plan.selectedMoments),
      storyboard: await workspace.store.writeJson('storyboard.json', plan.storyboard),
      timeline: await workspace.store.writeJson('timeline.json', plan.timeline),
      narration: await workspace.store.writeJson('narration.json', plan.narration),
      qualityReport: await workspace.store.writeJson('quality-report.json', plan.qualityReport),
      ...(llmTrace.path === undefined ? {} : {llmTrace: llmTrace.path}),
    }

    await jobStore.updateStage('plan', 'completed', undefined, 1)
    await jobStore.updateStage('align', 'completed', undefined, 1)
    await jobStore.updateStage('quality', 'completed', undefined, 1)
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      duration,
      outputPath,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      slides: plan.deck.slides.length,
      status: 'completed',
    }
  } catch (error) {
    const tracedError = withLLMTracePath(error, llmTrace.path)
    await jobStore.updateStage('transcribe', 'failed', tracedError.message, 1)
    throw tracedError
  }
}

export async function createDeckVoiceoverProject(options: CreateDeckVoiceoverProjectOptions): Promise<CreateDeckVoiceoverProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const llmTrace = createProjectLLMTrace(workspace, options.trace)

  await jobStore.initialize({
    inputPath: state.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('synthesize-voice', 'running', undefined, 1)

  try {
    const config = await readConfig(workspaceDir)
    const providers = await createRuntimeProviders(config, workspaceDir, {
      llmTrace: llmTrace.recorder,
    })
    const [deck, speakerScript, currentTimedDeck, currentStoryboard, currentSelectedMoments, currentMediaInfo] = await Promise.all([
      DeckSchema.parseAsync(await workspace.store.readJson('deck.json')),
      SpeakerScriptSchema.parseAsync(await workspace.store.readJson('speaker-script.json')),
      TimedDeckSchema.parseAsync(await workspace.store.readJson('timed-deck.json')),
      StoryboardSchema.parseAsync(await workspace.store.readJson('storyboard.json')),
      workspace.store.readJson('selected-moments.json') as Promise<LongVideoSelectedMoments>,
      workspace.store.readJson('media-info.json') as Promise<MediaInfo>,
    ])
    const initialNarration = createDeckNarrationFromSpeakerScript(speakerScript, currentTimedDeck)
    const ttsSegments = TtsSegmentsSchema.parse(await providers.tts.synthesize(initialNarration.segments, {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    }))
    const timings = createSlideTimingsFromTts(speakerScript, currentTimedDeck, ttsSegments)
    const totalDuration = timings.at(-1)?.end ?? 0
    const voiceoverPath = resolve(workspace.audioDir, 'deck_voiceover.wav')

    await renderDeckVoiceover(workspace.projectDir, ttsSegments, voiceoverPath)

    const timedDeck = TimedDeckSchema.parse({
      audioRef: 'audio/deck_voiceover.wav',
      deck,
      timings,
      version: 1,
    })
    const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
    const storyboard = StoryboardSchema.parse(updateStoryboardTiming(currentStoryboard, narration, timings))
    const timeline = TimelineSchema.parse(createTextTimeline(totalDuration))
    const selectedMoments = updateSelectedMomentsTiming(currentSelectedMoments, timings)
    const mediaInfo = {
      ...currentMediaInfo,
      duration: totalDuration,
      probedAt: new Date().toISOString(),
    }
    const issues = createTextQualityIssues({
      mediaInfo,
      narration,
      selectedMoments,
      storyboard,
      timeline,
    })
    const qualityReport = {
      checkedAt: new Date().toISOString(),
      issues,
      narrationSegments: narration.segments.length,
      summary: summarizeQualityIssues(issues),
      ttsSegments: ttsSegments.length,
      version: 1 as const,
    }
    const deckVoiceover = {
      duration: totalDuration,
      generatedAt: new Date().toISOString(),
      outputPath: 'audio/deck_voiceover.wav',
      segments: ttsSegments.map((segment, index) => {
        const timing = timings[index]

        return {
          duration: timing === undefined ? segment.duration : timing.end - timing.start,
          narrationId: segment.narrationId,
          path: segment.path,
          slideId: speakerScript.segments[index]?.slideId ?? `slide-${String(index + 1).padStart(3, '0')}`,
          start: timing?.start ?? 0,
        }
      }),
      version: 1 as const,
    }
    const artifacts = {
      ttsSegments: await workspace.store.writeJson('tts-segments.json', ttsSegments),
      deckVoiceover: await workspace.store.writeJson('deck-voiceover.json', deckVoiceover),
      timedDeck: await workspace.store.writeJson('timed-deck.json', timedDeck),
      mediaInfo: await workspace.store.writeJson('media-info.json', mediaInfo),
      selectedMoments: await workspace.store.writeJson('selected-moments.json', selectedMoments),
      storyboard: await workspace.store.writeJson('storyboard.json', storyboard),
      timeline: await workspace.store.writeJson('timeline.json', timeline),
      narration: await workspace.store.writeJson('narration.json', narration),
      qualityReport: await workspace.store.writeJson('quality-report.json', qualityReport),
      ...(llmTrace.path === undefined ? {} : {llmTrace: llmTrace.path}),
    }

    await jobStore.updateStage('synthesize-voice', 'completed', undefined, 1)
    await jobStore.updateStage('update-timing', 'completed', undefined, 1)
    await jobStore.updateStage('quality', 'completed', undefined, 1)
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      duration: totalDuration,
      outputPath: voiceoverPath,
      projectDir: workspace.projectDir,
      projectId,
      slides: deck.slides.length,
      status: 'voiced',
    }
  } catch (error) {
    const tracedError = withLLMTracePath(error, llmTrace.path)
    await jobStore.updateStage('synthesize-voice', 'failed', tracedError.message, 1)
    throw tracedError
  }
}

export async function createDeckFrameShardPlanProject(options: CreateDeckFrameShardPlanProjectOptions): Promise<CreateDeckFrameShardPlanProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
  const framesDir = resolve(workspace.rendersDir, 'deck-frames')
  const frameCaptureBackend = options.frameCaptureBackend ?? 'playwright'
  const frameShardSize = normalizeDeckFrameShardSize(options.frameShardSize)
  const timedDeckSourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
  const frames = createDeckHtmlFrameSequence({
    fps: DEFAULT_DECK_RENDER_FPS,
    outputDir: framesDir,
    timedDeck,
  })

  await mkdir(framesDir, {recursive: true})
  await workspace.store.writeJson('deck-frame-manifest.json', createPlannedDeckFrameManifest({
    concurrency: DEFAULT_DECK_FRAME_CONCURRENCY,
    fps: DEFAULT_DECK_RENDER_FPS,
    outputDir: framesDir,
    projectDir: workspace.projectDir,
    sourceSha256: timedDeckSourceSha256,
    timedDeck,
    renderer: frameCaptureBackend,
  }))

  const shards: DeckFrameShardPlanShard[] = []

  for (let frameStart = 1; frameStart <= frames.length; frameStart += frameShardSize) {
    const frameEnd = Math.min(frames.length, frameStart + frameShardSize - 1)
    const shardFrames = frames.filter((frame) => frame.frame >= frameStart && frame.frame <= frameEnd)
    // eslint-disable-next-line no-await-in-loop
    const missingFrames = await findMissingDeckFrameFiles(workspace.projectDir, shardFrames)
    const existingFrames = shardFrames.length - missingFrames.length
    const status = missingFrames.length === 0 ? 'complete' : existingFrames > 0 ? 'partial' : 'pending'

    shards.push({
      commandArgs: [
        'deck',
        'render',
        projectId,
        '--frame-start',
        String(frameStart),
        '--frame-end',
        String(frameEnd),
        ...(frameCaptureBackend === 'chromium' ? [] : ['--frame-capture-backend', frameCaptureBackend]),
      ],
      existingFrames,
      frameCount: shardFrames.length,
      frameEnd,
      frameStart,
      missingFrameSamples: missingFrames.slice(0, 5).map((frame) => ({
        frame: frame.frame,
        path: toProjectPath(workspace.projectDir, frame.path),
      })),
      missingFrames: missingFrames.length,
      shardArtifactPath: `artifacts/deck-frame-shard-${String(frameStart).padStart(6, '0')}-${String(frameEnd).padStart(6, '0')}.json`,
      status,
    })
  }

  const artifact = {
    completeShards: shards.filter((shard) => shard.status === 'complete').length,
    duration: roundSeconds(frames.length / DEFAULT_DECK_RENDER_FPS),
    finalizeArgs: ['deck', 'render', projectId, '--finalize-only'],
    fps: DEFAULT_DECK_RENDER_FPS,
    frameCount: frames.length,
    frameManifestPath: 'artifacts/deck-frame-manifest.json',
    frameShardSize,
    generatedAt: new Date().toISOString(),
    outputDir: toProjectPath(workspace.projectDir, framesDir),
    partialShards: shards.filter((shard) => shard.status === 'partial').length,
    pendingShards: shards.filter((shard) => shard.status === 'pending').length,
    renderer: frameCaptureBackend,
    shards,
    source: 'timed-deck.json',
    sourceSha256: timedDeckSourceSha256,
    version: 1 as const,
  }
  const artifactPath = await workspace.store.writeJson('deck-frame-shard-plan.json', artifact)

  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifactPath,
    completeShards: artifact.completeShards,
    duration: artifact.duration,
    finalizeArgs: artifact.finalizeArgs,
    frameCount: artifact.frameCount,
    frameShardSize,
    partialShards: artifact.partialShards,
    pendingShards: artifact.pendingShards,
    projectDir: workspace.projectDir,
    projectId,
    shardCount: shards.length,
    shards,
    status: 'planned',
  }
}

export async function createDeckFrameShardBatchProject(options: CreateDeckFrameShardBatchProjectOptions): Promise<CreateDeckFrameShardBatchProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await jobStore.initialize({
    inputPath: state.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('render-final', 'running', undefined, 1)

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
    const framesDir = resolve(workspace.rendersDir, 'deck-frames')
    const htmlOutputDir = resolve(workspace.rendersDir, 'html-shards')
    const frameCaptureBackend = options.frameCaptureBackend ?? 'playwright'
    const frameConcurrency = normalizeDeckFrameConcurrency(options.frameConcurrency)
    const shardConcurrency = normalizeDeckShardConcurrency(options.shardConcurrency)
    const shardRetries = normalizeDeckShardRetries(options.shardRetries)
    const shardRetryDelayMs = normalizeDeckShardRetryDelayMs(options.shardRetryDelayMs)
    const frameShardSize = normalizeDeckFrameShardSize(options.frameShardSize)
    const timedDeckSourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
    const reusableFrameManifest = await readReusableDeckFrameManifest(workspace, {
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      sourceSha256: timedDeckSourceSha256,
    })

    if (reusableFrameManifest === undefined) {
      await rm(framesDir, {force: true, recursive: true})
    }
    await Promise.all([
      rm(htmlOutputDir, {force: true, recursive: true}),
      mkdir(framesDir, {recursive: true}),
    ])

    const htmlProject = await writeDeckHtmlProject({
      outputDir: htmlOutputDir,
      timedDeck,
    })
    const frames = createDeckHtmlFrameSequence({
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      timedDeck,
    })
    const ranges = createDeckFrameShardRanges(frames.length, frameShardSize)
    let frameManifestPath = await workspace.store.writeJson('deck-frame-manifest.json', createPlannedDeckFrameManifest({
      concurrency: frameConcurrency,
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      projectDir: workspace.projectDir,
      renderer: frameCaptureBackend,
      sourceSha256: timedDeckSourceSha256,
      timedDeck,
    }))
    const shardResults = await runConcurrentMap(ranges, shardConcurrency, async (range): Promise<DeckFrameShardBatchShard> => {
      let attempts = 0

      try {
        const frameCapture = await retryDeckShardCapture({
          delayMs: shardRetryDelayMs,
          retries: shardRetries,
          run: async () => {
            attempts += 1

            return captureDeckHtmlFrameSequence({
              backend: frameCaptureBackend,
              chromiumCommand: options.chromiumCommand,
              concurrency: frameConcurrency,
              frameEnd: range.end,
              frameStart: range.start,
              fps: DEFAULT_DECK_RENDER_FPS,
              outputDir: framesDir,
              playwrightCommand: options.playwrightCommand,
              projectDir: htmlProject.outputDir,
              reuseExistingFrames: true,
              timedDeck,
            })
          },
        })
        const artifactPath = await workspace.store.writeJson(`deck-frame-shard-${String(range.start).padStart(6, '0')}-${String(range.end).padStart(6, '0')}.json`, createDeckFrameShardArtifact({
          frameCapture,
          projectDir: workspace.projectDir,
          sourceSha256: timedDeckSourceSha256,
        }))

        return {
          artifactPath,
          attempts,
          capturedFrames: frameCapture.capturedFrames,
          frameCount: range.end - range.start + 1,
          frameEnd: range.end,
          frameStart: range.start,
          skippedFrames: frameCapture.skippedFrames,
          status: 'complete',
        }
      } catch (error) {
        return {
          attempts,
          capturedFrames: 0,
          error: error instanceof Error ? error.message : String(error),
          frameCount: range.end - range.start + 1,
          frameEnd: range.end,
          frameStart: range.start,
          skippedFrames: 0,
          status: 'failed',
        }
      }
    })
    const frameCapture = createDeckFrameCaptureFromFrames({
      backend: frameCaptureBackend,
      capturedFrames: shardResults.reduce((total, shard) => total + shard.capturedFrames, 0),
      concurrency: frameConcurrency,
      fps: DEFAULT_DECK_RENDER_FPS,
      frames,
      outputDir: framesDir,
      skippedFrames: shardResults.reduce((total, shard) => total + shard.skippedFrames, 0),
      timedDeck,
    })

    frameManifestPath = await workspace.store.writeJson('deck-frame-manifest.json', createDeckFrameManifest({
      frameCapture,
      projectDir: workspace.projectDir,
      sourceSha256: timedDeckSourceSha256,
    }))

    const failedShards = shardResults.filter((shard) => shard.status === 'failed').length
    const completedShards = shardResults.length - failedShards
    const status = failedShards === 0 ? 'completed' as const : 'partial' as const
    const artifact = {
      completedShards,
      duration: frameCapture.duration,
      failedShards,
      fps: frameCapture.fps,
      frameCapturedCount: frameCapture.capturedFrames,
      frameConcurrency,
      frameCount: frameCapture.frames.length,
      frameManifestPath: toProjectPath(workspace.projectDir, frameManifestPath),
      frameShardSize,
      frameSkippedCount: frameCapture.skippedFrames,
      generatedAt: new Date().toISOString(),
      htmlOutputDir: toProjectPath(workspace.projectDir, htmlProject.outputDir),
      outputDir: toProjectPath(workspace.projectDir, frameCapture.outputDir),
      renderer: frameCaptureBackend,
      shardConcurrency,
      shardRetryDelayMs,
      shardRetries,
      shards: shardResults.map((shard) => ({
        ...(shard.artifactPath === undefined ? {} : {artifactPath: toProjectPath(workspace.projectDir, shard.artifactPath)}),
        attempts: shard.attempts,
        capturedFrames: shard.capturedFrames,
        ...(shard.error === undefined ? {} : {error: shard.error}),
        frameCount: shard.frameCount,
        frameEnd: shard.frameEnd,
        frameStart: shard.frameStart,
        skippedFrames: shard.skippedFrames,
        status: shard.status,
      })),
      source: 'timed-deck.json',
      sourceSha256: timedDeckSourceSha256,
      status,
      version: 1 as const,
    }
    const artifactPath = await workspace.store.writeJson('deck-frame-shard-batch.json', artifact)

    if (failedShards === 0) {
      await assertCompleteDeckFrameSequence(workspace.projectDir, frameCapture.frames)
      await jobStore.updateStage('render-final', 'completed', 'Frame shard batch captured; run finalize-only to encode final video.', 1)
    } else {
      await jobStore.updateStage('render-final', 'failed', `${failedShards} frame shard(s) failed; rerun the batch or capture failed ranges before finalize-only.`, 1)
    }
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      completedShards,
      failedShards,
      frameCapturedCount: frameCapture.capturedFrames,
      frameConcurrency,
      frameCount: frameCapture.frames.length,
      frameManifestPath,
      frameShardSize,
      frameSkippedCount: frameCapture.skippedFrames,
      htmlEntryPath: htmlProject.entryHtml,
      htmlOutputDir: htmlProject.outputDir,
      projectDir: workspace.projectDir,
      projectId,
      renderer: frameCaptureBackend,
      shardConcurrency,
      shardRetryDelayMs,
      shardRetries,
      shardCount: shardResults.length,
      shards: shardResults,
      status,
    }
  } catch (error) {
    await jobStore.updateStage('render-final', 'failed', error instanceof Error ? error.message : String(error), 1)
    throw error
  }
}

export async function createDeckRendererBackendProject(options: CreateDeckRendererBackendProjectOptions): Promise<CreateDeckRendererBackendProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
  const motionTimeline = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate).timeline
  const outputDir = resolve(options.outputDir ?? resolve(workspace.rendersDir, options.backend))
  const sourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
  const fps = normalizeDeckRendererFps(options.fps ?? motionTimeline.fps)
  const backendProject = options.backend === 'remotion'
    ? await writeRemotionDeckProject({
        compositionId: options.compositionId,
        fps,
        motionTimeline,
        outputDir,
        timedDeck,
      })
    : await writeMotionCanvasDeckProject({
        fps,
        motionTimeline,
        outputDir,
        timedDeck,
      })
  const artifact = createDeckRendererBackendArtifact({
    backend: options.backend,
    backendProject,
    motionTimeline,
    projectDir: workspace.projectDir,
    projectId,
    sourceSha256,
  })
  const artifactPath = await workspace.store.writeJson(`deck-renderer-${options.backend}.json`, artifact)

  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifactPath,
    backend: artifact.backend,
    commandCwd: resolveProjectPath(workspace.projectDir, artifact.commandCwd),
    files: Object.fromEntries(Object.entries(artifact.files).map(([key, value]) => [key, resolveProjectPath(workspace.projectDir, value)])),
    fps: artifact.fps,
    ...(artifact.height === undefined ? {} : {height: artifact.height}),
    motionTimelinePath: resolveProjectPath(workspace.projectDir, artifact.motionTimelinePath),
    outputDir: resolveProjectPath(workspace.projectDir, artifact.outputDir),
    previewCommand: artifact.previewCommand,
    projectDir: workspace.projectDir,
    projectId,
    renderCommand: artifact.renderCommand,
    sourceSha256,
    status: 'exported',
    ...(artifact.width === undefined ? {} : {width: artifact.width}),
  }
}

export async function createDeckRemotionRenderProject(options: CreateDeckRemotionRenderProjectOptions): Promise<CreateDeckRemotionRenderProjectResult> {
  const backendProject = await createDeckRendererBackendProject({
    backend: 'remotion',
    compositionId: options.compositionId,
    fps: options.fps,
    outputDir: options.outputDir,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const rendered = await renderRemotionDeckProject({
    command: options.command,
    outputPath: options.outputPath,
    projectDir: backendProject.outputDir,
  })
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const artifact = {
    backend: 'remotion' as const,
    command: rendered.command,
    commandCwd: toProjectPath(workspace.projectDir, backendProject.outputDir),
    completedAt: new Date().toISOString(),
    exportArtifactPath: toProjectPath(workspace.projectDir, backendProject.artifactPath),
    outputPath: toProjectPath(workspace.projectDir, rendered.outputPath),
    rendererProjectDir: toProjectPath(workspace.projectDir, backendProject.outputDir),
    source: 'timed-deck.json',
    sourceSha256: backendProject.sourceSha256,
    stderr: rendered.stderr,
    stdout: rendered.stdout,
    version: 1 as const,
  }
  const artifactPath = await workspace.store.writeJson('deck-renderer-remotion-output.json', artifact)

  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifactPath,
    backend: 'remotion',
    command: rendered.command,
    commandCwd: backendProject.outputDir,
    exportArtifactPath: backendProject.artifactPath,
    outputPath: rendered.outputPath,
    projectDir: workspace.projectDir,
    projectId,
    rendered,
    rendererProjectDir: backendProject.outputDir,
    sourceSha256: backendProject.sourceSha256,
    status: 'rendered',
  }
}

export async function createDeckFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  if ((options.renderer ?? 'remotion') === 'html') {
    return createDeckHtmlFinalRenderProject(options)
  }

  return createDeckRemotionFinalRenderProject(options)
}

async function createDeckHtmlFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await jobStore.initialize({
    inputPath: state.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('render-final', 'running', undefined, 1)

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
    const audioRef = timedDeck.audioRef ?? 'audio/deck_voiceover.wav'
    const audioPath = resolve(workspace.projectDir, audioRef)
    const framesDir = resolve(workspace.rendersDir, 'deck-frames')
    const htmlOutputDir = resolve(workspace.rendersDir, 'html')
    const htmlRenderedOutputPath = resolve(options.htmlOutput ?? resolve(workspace.rendersDir, 'deck_html_capture.mp4'))
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')
    const frameConcurrency = normalizeDeckFrameConcurrency(options.frameConcurrency)
    const requestedFrameRange = normalizeDeckFrameRange(options)
    const finalizeOnly = options.finalizeOnly === true
    const shouldFinalize = finalizeOnly || requestedFrameRange === undefined || options.finalize === true
    const timedDeckSourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
    const reusableFrameManifest = await readReusableDeckFrameManifest(workspace, {
      fps: DEFAULT_DECK_RENDER_FPS,
      outputDir: framesDir,
      sourceSha256: timedDeckSourceSha256,
    })
    const reuseExistingFrames = reusableFrameManifest !== undefined
    const finalizeOnlyManifest = resolveDeckFinalizeOnlyManifest({
      finalizeOnly,
      requestedFrameRange,
      reusableFrameManifest,
    })

    if (shouldFinalize) {
      await assertFileExists(audioPath)
    }
    if (!finalizeOnly && !reuseExistingFrames && requestedFrameRange === undefined) {
      await rm(framesDir, {force: true, recursive: true})
    }
    await rm(htmlOutputDir, {force: true, recursive: true})
    await mkdir(framesDir, {recursive: true})

    const htmlProject = await writeDeckHtmlProject({
      outputDir: htmlOutputDir,
      timedDeck,
    })
    const validation = options.htmlValidate === true
      ? await validateHyperframesProject({
          command: options.htmlRenderCommand,
          projectDir: htmlProject.outputDir,
        })
      : undefined
    const rendered = options.htmlRender === true
      ? await renderHyperframesProject({
          command: options.htmlRenderCommand,
          outputPath: htmlRenderedOutputPath,
          projectDir: htmlProject.outputDir,
        })
      : undefined
    const browserKeyframes = shouldFinalize && !finalizeOnly && !reuseExistingFrames
      ? await captureDeckHtmlKeyframes({
          backend: options.keyframeCaptureBackend,
          chromiumCommand: options.chromiumCommand,
          concurrency: frameConcurrency,
          fps: DEFAULT_DECK_RENDER_FPS,
          outputDir: resolve(workspace.rendersDir, 'deck-keyframes'),
          playwrightCommand: options.playwrightCommand,
          projectDir: htmlProject.outputDir,
          timedDeck,
        })
      : undefined
    let frameCapture: CaptureDeckHtmlFrameSequenceResult
    let frameManifestPath = workspace.store.resolve('deck-frame-manifest.json')

    if (finalizeOnlyManifest !== undefined) {
      frameCapture = createDeckFrameCaptureFromManifest({
        concurrency: frameConcurrency,
        manifest: finalizeOnlyManifest,
        projectDir: workspace.projectDir,
      })
    } else {
      await workspace.store.writeJson('deck-frame-manifest.json', createPlannedDeckFrameManifest({
        concurrency: frameConcurrency,
        fps: DEFAULT_DECK_RENDER_FPS,
        outputDir: framesDir,
        projectDir: workspace.projectDir,
        renderer: options.frameCaptureBackend ?? 'playwright',
        sourceSha256: timedDeckSourceSha256,
        timedDeck,
      }))
      frameCapture = await captureDeckHtmlFrameSequence({
        backend: options.frameCaptureBackend,
        chromiumCommand: options.chromiumCommand,
        concurrency: frameConcurrency,
        frameEnd: requestedFrameRange?.end,
        frameStart: requestedFrameRange?.start,
        fps: DEFAULT_DECK_RENDER_FPS,
        outputDir: framesDir,
        playwrightCommand: options.playwrightCommand,
        projectDir: htmlProject.outputDir,
        reuseExistingFrames,
        timedDeck,
      })
      frameManifestPath = await workspace.store.writeJson('deck-frame-manifest.json', createDeckFrameManifest({
        frameCapture,
        projectDir: workspace.projectDir,
        sourceSha256: timedDeckSourceSha256,
      }))
    }
    const deckQualityReport = DeckQualityReportSchema.parse(createDeckQualityReport(timedDeck))
    const deckQualityReportPath = await workspace.store.writeJson('deck-quality-report.json', deckQualityReport)

    if (!shouldFinalize) {
      const artifactPath = await workspace.store.writeJson(`deck-frame-shard-${String(frameCapture.frameStart).padStart(6, '0')}-${String(frameCapture.frameEnd).padStart(6, '0')}.json`, createDeckFrameShardArtifact({
        frameCapture,
        projectDir: workspace.projectDir,
        sourceSha256: timedDeckSourceSha256,
      }))

      await jobStore.updateStage('render-final', 'completed', 'Frame shard captured; final encode was not run.', 1)
      await refreshArtifactManifest(workspace.artifactsDir)

      return {
        artifactPath,
        audioPath,
        deckQualityReportPath,
        finalized: false,
        frameCount: frameCapture.frames.length,
        frameEnd: frameCapture.frameEnd,
        frameManifestPath,
        frameRenderer: frameCapture.backend,
        frameStart: frameCapture.frameStart,
        htmlEntryPath: htmlProject.entryHtml,
        htmlOutputDir: htmlProject.outputDir,
        outputPath,
        projectDir: workspace.projectDir,
        projectId,
        ...(rendered === undefined ? {} : {rendered}),
        renderer: 'html',
        status: 'frames-rendered',
        ...(validation === undefined ? {} : {validation}),
        videoRenderer: deckFrameVideoRenderer(frameCapture.backend),
      }
    }

    await assertCompleteDeckFrameSequence(workspace.projectDir, frameCapture.frames)

    const keyframeQuality = await createDeckKeyframeQuality(workspace, frameCapture, browserKeyframes)
    const keyframeQualityPath = await workspace.store.writeJson('deck-keyframes.json', keyframeQuality.artifact)
    const subtitleOutput = await writeDeckSubtitles(workspace, timedDeck)

    await renderDeckFrameSequenceVideo(frameCapture.pattern, frameCapture.fps, silentVideoPath)
    await muxDeckFinalVideo({
      audioPath,
      outputPath,
      silentVideoPath,
      subtitlePath: subtitleOutput.outputPath,
    })

    const outputQuality = await inspectDeckRenderedOutput(outputPath, {
      expectedDuration: timedDeck.timings.at(-1)?.end ?? 0,
    })
    const artifactPath = await workspace.store.writeJson('render-output.json', {
      audioInputs: 1,
      audioPath: toProjectPath(workspace.projectDir, audioPath),
      completedAt: new Date().toISOString(),
      entryHtml: toProjectPath(workspace.projectDir, htmlProject.entryHtml),
      finalizeOnly,
      finalized: true,
      frameCaptureDuration: frameCapture.duration,
      frameCapturedCount: frameCapture.capturedFrames,
      frameConcurrency: frameCapture.concurrency,
      frameCount: frameCapture.frames.length,
      frameEnd: frameCapture.frameEnd,
      frameFps: frameCapture.fps,
      frameManifestPath: toProjectPath(workspace.projectDir, frameManifestPath),
      framePattern: toProjectPath(workspace.projectDir, frameCapture.pattern),
      frameReuse: reuseExistingFrames,
      frameRenderer: frameCapture.backend,
      frameSkippedCount: frameCapture.skippedFrames,
      frameStart: frameCapture.frameStart,
      framesDir: toProjectPath(workspace.projectDir, frameCapture.outputDir),
      keyframeQualityPath: toProjectPath(workspace.projectDir, keyframeQualityPath),
      keyframeRenderer: keyframeQuality.artifact.renderer,
      outputDir: toProjectPath(workspace.projectDir, htmlProject.outputDir),
      outputPath: toProjectPath(workspace.projectDir, outputPath),
      outputQuality,
      planPath: toProjectPath(workspace.projectDir, htmlProject.planPath),
    renderer: 'html' as const,
      rendered,
      runtimePath: toProjectPath(workspace.projectDir, htmlProject.runtimePath),
      silentVideoPath: toProjectPath(workspace.projectDir, silentVideoPath),
      source: 'timed-deck.json',
      sourceSha256: timedDeckSourceSha256,
      stylesPath: toProjectPath(workspace.projectDir, htmlProject.stylesPath),
      subtitleMuxMode: 'mov_text' as const,
      subtitleMuxed: true,
      subtitlePath: toProjectPath(workspace.projectDir, subtitleOutput.outputPath),
      subtitleQuality: subtitleOutput.quality,
      subtitlesBurned: false,
      validation,
      version: 1 as const,
      videoRenderer: deckFrameVideoRenderer(frameCapture.backend),
      visualQuality: keyframeQuality.visualQuality,
    })

    await jobStore.updateStage('render-final', 'completed', undefined, 1)
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      audioPath,
      deckQualityReportPath,
      finalized: true,
      frameCount: frameCapture.frames.length,
      frameEnd: frameCapture.frameEnd,
      frameManifestPath,
      frameRenderer: frameCapture.backend,
      frameStart: frameCapture.frameStart,
      htmlEntryPath: htmlProject.entryHtml,
      htmlOutputDir: htmlProject.outputDir,
      keyframeQualityPath,
      keyframeRenderer: keyframeQuality.artifact.renderer,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      ...(rendered === undefined ? {} : {rendered}),
      renderer: 'html',
      status: 'rendered',
      subtitleMuxMode: 'mov_text',
      subtitleMuxed: true,
      subtitlePath: subtitleOutput.outputPath,
      subtitleQuality: subtitleOutput.quality,
      ...(validation === undefined ? {} : {validation}),
      videoRenderer: deckFrameVideoRenderer(frameCapture.backend),
      visualQuality: keyframeQuality.visualQuality,
    }
  } catch (error) {
    await jobStore.updateStage('render-final', 'failed', error instanceof Error ? error.message : String(error), 1)
    throw error
  }
}

async function createDeckRemotionFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await jobStore.initialize({
    inputPath: state.inputPath,
    pipeline: DECK_PIPELINE_DEFINITION.kind,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('render-final', 'running', undefined, 1)

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
    const audioRef = timedDeck.audioRef ?? 'audio/deck_voiceover.wav'
    const audioPath = resolve(workspace.projectDir, audioRef)
    const remotionOutputDir = resolve(workspace.rendersDir, 'remotion')
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')
    const sourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
    const motionTimeline = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate).timeline
    const fps = normalizeDeckRendererFps(motionTimeline.fps)

    await assertFileExists(audioPath)
    await rm(remotionOutputDir, {force: true, recursive: true})
    await removeDeckHtmlFrameArtifacts(workspace)
    await mkdir(workspace.rendersDir, {recursive: true})

    const remotionProject = await writeRemotionDeckProject({
      compositionId: options.compositionId,
      fps,
      motionTimeline,
      outputDir: remotionOutputDir,
      timedDeck,
    })
    const backendArtifact = createDeckRendererBackendArtifact({
      backend: 'remotion',
      backendProject: remotionProject,
      motionTimeline,
      projectDir: workspace.projectDir,
      projectId,
      sourceSha256,
    })
    const backendArtifactPath = await workspace.store.writeJson('deck-renderer-remotion.json', backendArtifact)
    const remotion = await renderRemotionDeckMedia({
      outputPath: silentVideoPath,
      project: remotionProject,
    })
    const deckQualityReport = DeckQualityReportSchema.parse(createDeckQualityReport(timedDeck))
    const deckQualityReportPath = await workspace.store.writeJson('deck-quality-report.json', deckQualityReport)
    const subtitleOutput = await writeDeckSubtitles(workspace, timedDeck)

    await muxDeckFinalVideo({
      audioPath,
      outputPath,
      silentVideoPath,
      subtitlePath: subtitleOutput.outputPath,
    })

    const outputQuality = await inspectDeckRenderedOutput(outputPath, {
      expectedDuration: timedDeck.timings.at(-1)?.end ?? 0,
    })
    const artifactPath = await workspace.store.writeJson('render-output.json', {
      audioInputs: 1,
      audioPath: toProjectPath(workspace.projectDir, audioPath),
      backendArtifactPath: toProjectPath(workspace.projectDir, backendArtifactPath),
      completedAt: new Date().toISOString(),
      finalized: true,
      outputPath: toProjectPath(workspace.projectDir, outputPath),
      outputQuality,
      renderer: 'remotion' as const,
      remotion: {
        codec: remotion.codec,
        compositionId: remotion.compositionId,
        concurrency: remotion.concurrency,
        imageFormat: remotion.imageFormat,
        jpegQuality: remotion.jpegQuality,
        outputPath: toProjectPath(workspace.projectDir, remotion.outputPath),
        slowestFrames: remotion.slowestFrames.slice(0, 10),
        x264Preset: remotion.x264Preset,
      },
      rendererProjectDir: toProjectPath(workspace.projectDir, remotionProject.outputDir),
      silentVideoPath: toProjectPath(workspace.projectDir, silentVideoPath),
      source: 'timed-deck.json',
      sourceSha256,
      subtitleMuxMode: 'mov_text' as const,
      subtitleMuxed: true,
      subtitlePath: toProjectPath(workspace.projectDir, subtitleOutput.outputPath),
      subtitleQuality: subtitleOutput.quality,
      subtitlesBurned: false,
      version: 1 as const,
      videoRenderer: 'remotion+ffmpeg' as const,
    })

    await jobStore.updateStage('render-final', 'completed', undefined, 1)
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      audioPath,
      deckQualityReportPath,
      finalized: true,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      remotion,
      renderer: 'remotion',
      status: 'rendered',
      subtitleMuxMode: 'mov_text',
      subtitleMuxed: true,
      subtitlePath: subtitleOutput.outputPath,
      subtitleQuality: subtitleOutput.quality,
      videoRenderer: 'remotion+ffmpeg',
    }
  } catch (error) {
    await jobStore.updateStage('render-final', 'failed', error instanceof Error ? error.message : String(error), 1)
    throw error
  }
}

async function convertDeckSourceAudio(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    outputPath,
  ])
}

const LLM_DECK_MOTION_PRESETS = ['fade-in', 'slide-up', 'soft-scale', 'blur-rise', 'stagger-up', 'progressive-reveal', 'card-stack', 'line-draw', 'number-count', 'spotlight', 'wipe', 'zoom-focus', 'cinematic-rise'] as const

const LLMTextDeckPlanSchema = z.object({
  audience: z.string().optional(),
  slides: z.array(z.object({
    code: z.object({
      language: z.string().min(1).default('text'),
      text: z.string().min(1),
    }).optional(),
    comparison: z.object({
      left: z.object({
        label: z.string().min(1),
        points: z.array(z.string().min(1)).default([]),
      }),
      right: z.object({
        label: z.string().min(1),
        points: z.array(z.string().min(1)).default([]),
      }),
    }).optional(),
    duration: z.number().finite().positive().optional(),
    motion: z.string().min(1).optional(),
    points: z.array(z.string().min(1)).default([]),
    quote: z.object({
      attribution: z.string().min(1).optional(),
      text: z.string().min(1),
    }).optional(),
    speakerNote: z.string().optional(),
    stat: z.object({
      caption: z.string().min(1).optional(),
      label: z.string().min(1),
      value: z.string().min(1),
    }).optional(),
    subtitle: z.string().min(1).optional(),
    title: z.string().min(1),
    type: z.string().min(1).optional(),
  })).min(1).max(24),
  summary: z.string().min(1),
  theme: z.string().min(1).optional(),
  title: z.string().min(1),
})

type LLMTextDeckPlan = z.infer<typeof LLMTextDeckPlanSchema>
type LLMTextDeckSlide = LLMTextDeckPlan['slides'][number]

interface NormalizedLLMTextDeckSlide extends Omit<LLMTextDeckSlide, 'comparison' | 'motion' | 'points' | 'subtitle' | 'type'> {
  comparison?: {
    left: {
      label: string
      points: string[]
    }
    right: {
      label: string
      points: string[]
    }
  }
  motion?: Slide['motion']
  points: string[]
  speakerNote: string
  subtitle?: string
  type: DeckSlideType
}

interface TextDeckProjectPlanOptions {
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  language: string
  maxSlideCharacters: number
  slideSeconds: number
  sourceType?: Document['source']['sourceType']
  theme?: string
  title?: string
}

async function createLLMTextDeckProjectPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
): Promise<TextDeckProjectPlan> {
  const targetSlideCount = estimateTextDeckSlideCount(text, options.durationTargetSeconds)
  const result = await llm.generateObject({
    messages: [
      {
        content: JSON.stringify({
          goal: 'Turn the source Markdown/text into a concise PPT-style explainer deck. Return only clean semantic slide data matching the schema.',
          instructions: [
            'Use the requested output language for all visible text and speaker notes.',
            'Remove YAML frontmatter, Markdown syntax, code fences, table pipes, raw template markers, and implementation-only metadata.',
            'Do not split sentences by character count. Merge related source sections into audience-facing ideas.',
            'If the source is an agent skill or internal instruction document, explain what it does, when to use it, the workflow, output shape, and quality bar.',
            'Do not paste the raw source verbatim. Rewrite it into natural presentation language.',
            'Keep slide titles short and concrete.',
            'Use concise visible text and respect each template field and limit in target.templateManifest.',
            'Choose slide type only from target.templateManifest.templates. Do not invent, rename, or translate type values.',
            'If content exceeds a template limit, split it into multiple slides instead of overfilling one slide.',
            'Do not put multiple unrelated themes on one slide; split by topic before choosing a template.',
            'Only use comparison when the comparison field has left and right labels plus 2-3 concrete points on each side. Otherwise use three-points or one-big-idea.',
            'Only use stat when the stat field contains a meaningful value, label, and supporting caption or points. Avoid decorative single-number slides.',
            'For process or timeline slides, include every major step needed to make the title true. Do not title a slide "seven steps" unless the visible points contain all seven steps.',
            'When explaining a method or framework, include at least one concrete application example, evidence workflow, validation path, or output shape unless the source forbids examples.',
            'For finance or research frameworks, preserve evidence sources, validation or kill criteria, freshness caveats, and non-advice disclaimers when present.',
            'Choose motion only from controlled presets; do not describe CSS, colors, fonts, or absolute positions.',
            'Write one natural speakerNote per slide for TTS. It should sound like a presenter guiding the viewer through the slide, not a file reader.',
            'The speakerNote MUST walk the viewer through the on-screen content in order. Expand each visible point into a natural spoken sentence. Do not skip any point.',
            'Match the speakerNote specificity to the on-screen content. If a point shows a formula, mention the formula. If a point lists specific items, name the key ones. Do not summarize vaguely when the screen shows concrete details.',
            'Do not introduce new arguments, examples, claims, or steps that are not visible on the current slide, except for brief transition phrases that reference the previous or next slide topic.',
            'For comparison slides, describe both sides. For code slides, briefly explain each visible section. For stat, quote, and chart slides, explicitly mention the displayed value, quote, or chart takeaway.',
            'Add brief transitions between slides: start each speakerNote except the first by connecting to the previous slide, and end each speakerNote except the last with a short phrase previewing the next slide. Keep each transition to one short clause.',
            'The speakerNote must not claim a specific number of steps, phases, reasons, metrics, scenarios, or criteria unless the visible content contains that exact number. If the slide shows 4 points, say "the key steps" or "four main steps", not "seven steps".',
            'Avoid page-number prefixes such as "第 1 页" in speakerNote.',
            'Keep speakerNote close to the target narration length unless the slide is an intro or summary.',
            'Choose the most appropriate visual theme from the available themes based on the content topic and tone. Return the theme name in the "theme" field.',
          ],
          source: {
            path: inputPath,
            sourceType: options.sourceType ?? inferDocumentSourceType(inputPath),
            text: truncateForLLM(text, 60_000),
          },
          target: {
            availableThemes: Object.entries(DECK_THEME_DESCRIPTIONS).map(([name, description]) => ({description, name})),
            durationSeconds: options.durationTargetSeconds,
            format: options.deckFormat ?? 'portrait_1080x1920',
            language: options.language,
            maxVisibleCharactersPerSlide: options.maxSlideCharacters,
            requestedTheme: options.theme === undefined || options.theme === 'auto' ? undefined : options.theme,
            requestedTitle: options.title,
            slideCount: targetSlideCount,
            speakerNoteCharactersPerSlide: estimateNarrationCharactersPerSlide(options.durationTargetSeconds, targetSlideCount),
            templateManifest: deckTemplateManifestForLLM,
          },
        }),
        role: 'user',
      },
    ],
    schema: LLMTextDeckPlanSchema,
    temperature: 0.2,
  })

  return createTextDeckProjectPlanFromLLM(inputPath, text, result.object, options)
}

function createTextDeckProjectPlanFromLLM(inputPath: string, sourceText: string, rawPlan: LLMTextDeckPlan, options: TextDeckProjectPlanOptions): TextDeckProjectPlan {
  const planTitle = options.title ?? cleanGeneratedText(rawPlan.title, 'Deck Explainer')
  const slides = normalizeLLMTextDeckSlides(rawPlan)
  const sourceEvidence = truncateForLLM(stripMarkdownControlText(sourceText), 4000)
  const deckSlides = slides.map((slide, index): Slide => {
    const slideId = `slide-${String(index + 1).padStart(3, '0')}`
    const blockId = `block-${String(index + 1).padStart(3, '0')}`

    return {
      blockIds: [blockId],
      ...(slide.code === undefined ? {} : {code: slide.code}),
      ...(slide.comparison === undefined ? {} : {comparison: slide.comparison}),
      duration: slide.duration,
      evidence: sourceEvidence === '' ? [] : [{ref: 'text-input', text: sourceEvidence, type: 'research'}],
      motion: slide.motion ?? defaultSlideMotion(index, slide.type),
      points: slide.points,
      ...(slide.quote === undefined ? {} : {quote: slide.quote}),
      slideId,
      speakerNote: slide.speakerNote,
      ...(slide.stat === undefined ? {} : {stat: slide.stat}),
      ...(slide.subtitle === undefined ? {} : {subtitle: slide.subtitle}),
      title: slide.title,
      type: slide.type ?? (index === 0 ? 'hero' : 'three-points'),
      visual: {
        assetRefs: [],
        kind: visualKindForSlideType(slide.type ?? (index === 0 ? 'hero' : 'three-points')),
      },
    }
  })
  const resolvedTheme = resolveTheme(rawPlan.theme, options.theme)
  const deck = DeckSchema.parse({
    format: options.deckFormat ?? 'portrait_1080x1920',
    inputMode: 'script-generated',
    language: options.language,
    slides: deckSlides,
    theme: resolvedTheme,
    title: planTitle,
    version: 1,
  })
  const speakerScript = SpeakerScriptSchema.parse({
    language: options.language,
    mode: 'script-generated',
    segments: slides.map((slide, index) => ({
      estimatedDuration: slide.duration ?? estimateNarrationDuration(slide.speakerNote),
      slideId: deck.slides[index]?.slideId ?? `slide-${String(index + 1).padStart(3, '0')}`,
      text: slide.speakerNote,
    })),
    version: 1,
  })
  const timings = createSlideTimingsFromSpeakerScript(speakerScript, options.durationTargetSeconds, options.slideSeconds)
  const timedDeck = TimedDeckSchema.parse(createTimedDeck(deck, timings))
  const duration = timings.at(-1)?.end ?? deck.slides.length * options.slideSeconds
  const mediaInfo = createTextMediaInfo(inputPath, duration)
  const document = DocumentSchema.parse(createLLMTextDocument(inputPath, sourceText, deck, speakerScript, options.language, planTitle, rawPlan.summary, options.sourceType))
  const contentBlocks = ContentBlocksSchema.parse({
    blocks: document.blocks,
    version: 1,
  })
  const claims = ClaimsSchema.parse(createClaimsFromDocument(document))
  const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromDocument(document))
  const outline = OutlineSchema.parse(createDeckOutlineFromSlides(deck, options.language, planTitle, options.durationTargetSeconds, rawPlan.audience))
  const selectedMoments = createDeckSelectedMoments(inputPath, deck, speakerScript, timings)
  const storyboard = StoryboardSchema.parse(createDeckStoryboard(deck, speakerScript, timings, options.language))
  const timeline = TimelineSchema.parse(createTextTimeline(duration))
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
  const qualityReport = createTextPlanQualityReport({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })

  return {
    claims,
    contentBlocks,
    deck,
    document,
    mediaInfo,
    narration,
    outline,
    qualityReport,
    selectedMoments,
    sourceQuotes,
    speakerScript,
    storyboard,
    timedDeck,
    timeline,
  }
}

function createAudioAnchoredDeckProjectPlan(plan: TextDeckProjectPlan, inputPath: string, sourceMediaInfo: MediaInfo, duration: number, language: string, fallbackSlideSeconds: number): TextDeckProjectPlan {
  const deck = DeckSchema.parse({
    ...plan.deck,
    inputMode: 'audio-anchored',
    language,
  })
  const speakerScript = SpeakerScriptSchema.parse({
    ...plan.speakerScript,
    language,
    mode: 'audio-anchored',
  })
  const timings = createSlideTimingsWithinDuration(speakerScript, duration, fallbackSlideSeconds)
  const timedDeck = TimedDeckSchema.parse({
    audioRef: 'audio/deck_voiceover.wav',
    deck,
    timings,
    version: 1,
  })
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
  const storyboard = StoryboardSchema.parse(createDeckStoryboard(deck, speakerScript, timings, language))
  const timeline = TimelineSchema.parse(createTextTimeline(duration))
  const selectedMoments = createDeckSelectedMoments(inputPath, deck, speakerScript, timings, {
    chunkId: 'audio-000',
    idPrefix: 'audio-slide',
    reason: 'LLM-planned audio transcript section aligned to the source audio.',
  })
  const mediaInfo = MediaInfoSchema.parse({
    ...sourceMediaInfo,
    duration,
    probedAt: new Date().toISOString(),
    version: 1,
  })
  const qualityReport = createTextPlanQualityReport({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })

  return {
    ...plan,
    deck,
    mediaInfo,
    narration,
    qualityReport,
    selectedMoments,
    speakerScript,
    storyboard,
    timedDeck,
    timeline,
  }
}

function normalizeLLMTextDeckSlides(plan: LLMTextDeckPlan): NormalizedLLMTextDeckSlide[] {
  const slides = plan.slides.map((slide, index) => {
    const {comparison: rawComparison, motion: rawMotion, subtitle: rawSubtitle, type: rawType, ...rest} = slide
    const title = cleanGeneratedText(slide.title, `第 ${index + 1} 页`).slice(0, 72)
    const points = slide.points
      .map((point) => cleanGeneratedText(point, ''))
      .filter((point) => point !== '' && point !== title)
      .slice(0, 16)
    const comparison = normalizeLLMComparison(rawComparison)
    const speakerNote = cleanGeneratedText(slide.speakerNote, [title, ...points].join('。'))
    const subtitle = cleanGeneratedText(rawSubtitle, '')
    const motion = normalizeLLMMotion(rawMotion)
    const type = normalizeLLMSlideTypeForContent(normalizeLLMSlideType(rawType, index), {
      comparison,
      points,
      slide,
    }, index)

    return {
      ...rest,
      ...(comparison === undefined ? {} : {comparison}),
      ...(motion === undefined ? {} : {motion}),
      points,
      speakerNote,
      ...(subtitle === '' ? {} : {subtitle}),
      title,
      type,
    }
  }).filter((slide) => slide.title !== '' && slide.speakerNote !== '')

  const repairedSlides = repairLLMTextDeckSlides(slides)

  return repairedSlides.length === 0
    ? [{
        motion: 'cinematic-rise',
        points: [],
        speakerNote: cleanGeneratedText(plan.summary, plan.title),
        title: cleanGeneratedText(plan.title, 'Deck Explainer'),
        type: 'hero',
      }]
    : repairedSlides
}

function repairLLMTextDeckSlides(slides: NormalizedLLMTextDeckSlide[]): NormalizedLLMTextDeckSlide[] {
  return slides.flatMap((slide) => repairLLMTextDeckSlide(slide))
}

function repairLLMTextDeckSlide(slide: NormalizedLLMTextDeckSlide): NormalizedLLMTextDeckSlide[] {
  if (slide.type === 'comparison' && slide.comparison !== undefined) {
    return [{
      ...slide,
      comparison: {
        left: {
          ...slide.comparison.left,
          points: slide.comparison.left.points.slice(0, findDeckTemplateManifestEntry('comparison').limits.left_points),
        },
        right: {
          ...slide.comparison.right,
          points: slide.comparison.right.points.slice(0, findDeckTemplateManifestEntry('comparison').limits.right_points),
        },
      },
    }]
  }

  const maxPoints = maxPointsForDeckTemplate(slide.type)

  if (maxPoints === undefined || slide.points.length <= maxPoints) {
    return [slide]
  }

  if (findDeckTemplateManifestEntry(slide.type).repair !== 'split-points') {
    return [{
      ...slide,
      points: slide.points.slice(0, maxPoints),
    }]
  }

  const chunks = chunk(slide.points, maxPoints)

  return chunks.map((points, index) => ({
    ...slide,
    points,
    title: index === 0 ? slide.title : `${slide.title}（续）`,
    type: index === 0 ? slide.type : continuationTemplateType(slide.type),
  }))
}

function continuationTemplateType(type: DeckSlideType): DeckSlideType {
  if (type === 'hero' || type === 'stat' || type === 'chart') {
    return 'three-points'
  }

  return type
}

function normalizeLLMComparison(comparison: LLMTextDeckSlide['comparison']): NormalizedLLMTextDeckSlide['comparison'] {
  if (comparison === undefined) {
    return undefined
  }

  const leftLabel = cleanGeneratedText(comparison.left.label, '')
  const rightLabel = cleanGeneratedText(comparison.right.label, '')
  const leftPoints = cleanGeneratedPoints(comparison.left.points, 3)
  const rightPoints = cleanGeneratedPoints(comparison.right.points, 3)

  if (leftLabel === '' || rightLabel === '' || leftPoints.length === 0 || rightPoints.length === 0) {
    return undefined
  }

  return {
    left: {
      label: leftLabel,
      points: leftPoints,
    },
    right: {
      label: rightLabel,
      points: rightPoints,
    },
  }
}

function cleanGeneratedPoints(points: string[], limit: number): string[] {
  return points
    .map((point) => cleanGeneratedText(point, ''))
    .filter((point) => point !== '')
    .slice(0, limit)
}

function normalizeLLMSlideType(type: string | undefined, index: number): DeckSlideType {
  return isDeckTemplateType(type) ? type : index === 0 ? 'hero' : 'three-points'
}

function normalizeLLMSlideTypeForContent(
  type: DeckSlideType,
  input: {
    comparison: NormalizedLLMTextDeckSlide['comparison']
    points: string[]
    slide: LLMTextDeckSlide
  },
  index: number,
): DeckSlideType {
  if (index === 0) {
    return 'hero'
  }

  if (type === 'comparison' && input.comparison === undefined) {
    return input.points.length >= 2 ? 'three-points' : 'one-big-idea'
  }

  if (type === 'stat' && input.slide.stat === undefined) {
    return input.points.length >= 2 ? 'three-points' : 'one-big-idea'
  }

  if (type === 'quote' && input.slide.quote === undefined) {
    return 'one-big-idea'
  }

  if (type === 'code' && input.slide.code === undefined) {
    return input.points.length >= 2 ? 'three-points' : 'one-big-idea'
  }

  if ((type === 'chart' || type === 'process' || type === 'timeline' || type === 'summary' || type === 'three-points') && input.points.length === 0) {
    return 'one-big-idea'
  }

  return type
}

function normalizeLLMMotion(motion: string | undefined): Slide['motion'] | undefined {
  return isLLMDeckMotionPreset(motion) ? motion : undefined
}

function isLLMDeckMotionPreset(value: unknown): value is Slide['motion'] {
  return typeof value === 'string' && (LLM_DECK_MOTION_PRESETS as readonly string[]).includes(value)
}

function createLLMTextDocument(
  inputPath: string,
  sourceText: string,
  deck: Deck,
  speakerScript: SpeakerScript,
  language: string,
  title: string,
  summary: string,
  sourceType: Document['source']['sourceType'] | undefined,
): Document {
  const sourceEvidence = truncateForLLM(stripMarkdownControlText(sourceText), 4000)

  return {
    blocks: deck.slides.map((slide, index): ContentBlock => {
      const script = speakerScript.segments[index]?.text
      const text = [slide.title, slide.subtitle, ...deckSlideContentParts(slide), script].filter((value): value is string => typeof value === 'string' && value.trim() !== '').join(' ')

      return {
        evidence: sourceEvidence === '' ? [] : [{ref: 'text-input', text: sourceEvidence, type: 'research'}],
        id: `block-${String(index + 1).padStart(3, '0')}`,
        text: text || slide.title,
        type: index === 0 ? 'summary' : contentBlockTypeForSlide(slide),
      }
    }),
    source: {
      language,
      path: inputPath,
      sourceType: sourceType ?? inferDocumentSourceType(inputPath),
      title,
    },
    text: [title, cleanGeneratedText(summary, ''), ...speakerScript.segments.map((segment) => segment.text)].filter(Boolean).join('\n\n'),
    version: 1,
  }
}

function contentBlockTypeForSlide(slide: Slide): ContentBlock['type'] {
  if (slide.type === 'quote') {
    return 'quote'
  }

  if (slide.type === 'cta') {
    return 'recommendation'
  }

  if (slide.type === 'summary') {
    return 'summary'
  }

  if (slide.type === 'chart' || slide.type === 'stat' || slide.type === 'timeline') {
    return 'data'
  }

  return 'claim'
}

function createDeckOutlineFromSlides(deck: Deck, language: string, title: string, durationTarget: number | undefined, audience: string | undefined): Outline {
  return {
    ...(audience === undefined ? {} : {audience: cleanGeneratedText(audience, '')}),
    durationTarget,
    language,
    sections: deck.slides.map((slide, index) => ({
      blockIds: slide.blockIds,
      duration: slide.duration,
      goal: slide.speakerNote ?? `Explain ${slide.title}.`,
      id: `section-${String(index + 1).padStart(3, '0')}`,
      title: slide.title,
    })),
    title,
    version: 1,
  }
}

function createDeckSelectedMoments(
  inputPath: string,
  deck: Deck,
  speakerScript: SpeakerScript,
  timings: SlideTiming[],
  options: {
    chunkId?: string
    idPrefix?: string
    reason?: string
  } = {},
): LongVideoSelectedMoments {
  const chunkId = options.chunkId ?? 'text-000'
  const idPrefix = options.idPrefix ?? 'text-slide'
  const reason = options.reason ?? 'LLM-planned text section converted into a slide explainer page.'

  return {
    moments: deck.slides.map((slide, index) => {
      const timing = timings[index] ?? {end: index + 1, slideId: slide.slideId, start: index}
      const script = speakerScript.segments[index]

      return {
        chunkId,
        evidence: slide.evidence,
        id: `${idPrefix}-${String(index + 1).padStart(3, '0')}`,
        reason,
        score: 0.85,
        sourceRange: [timing.start, timing.end] as [number, number],
        summary: script?.text ?? slide.speakerNote ?? slide.title,
        title: slide.title,
      }
    }),
    source: inputPath,
    version: 1,
  }
}

function createDeckStoryboard(deck: Deck, speakerScript: SpeakerScript, timings: SlideTiming[], language: string): Storyboard {
  return {
    language,
    scenes: deck.slides.map((slide, index) => {
      const timing = timings[index] ?? {end: index + 1, slideId: slide.slideId, start: index}
      const script = speakerScript.segments[index]

      return {
        duration: Math.max(0.001, roundSeconds(timing.end - timing.start)),
        evidence: slide.evidence,
        id: `scene-${index + 1}`,
        narration: script?.text ?? slide.speakerNote ?? slide.title,
        sourceRange: [timing.start, timing.end] as [number, number],
        start: timing.start,
        visualStyle: 'slide_explainer',
      }
    }),
    targetPlatform: 'generic',
    version: 1,
  }
}

function createSlideTimingsFromSpeakerScript(speakerScript: SpeakerScript, durationTargetSeconds: number | undefined, fallbackSlideSeconds: number): SlideTiming[] {
  const segmentCount = Math.max(1, speakerScript.segments.length)
  const targetDuration = durationTargetSeconds === undefined ? undefined : Math.max(segmentCount * 2, durationTargetSeconds)
  let cursor = 0

  return speakerScript.segments.map((segment) => {
    const duration = targetDuration === undefined
      ? Math.max(2, segment.estimatedDuration ?? fallbackSlideSeconds)
      : targetDuration / segmentCount
    const start = roundSeconds(cursor)
    const end = roundSeconds(start + duration)

    cursor = end

    return {
      end,
      slideId: segment.slideId,
      start,
    }
  })
}

function createSlideTimingsWithinDuration(speakerScript: SpeakerScript, duration: number, fallbackSlideSeconds: number): SlideTiming[] {
  const segmentCount = Math.max(1, speakerScript.segments.length)
  const totalDuration = roundSeconds(Math.max(0.1, duration))
  const weights = speakerScript.segments.map((segment) => Math.max(0.1, segment.estimatedDuration ?? fallbackSlideSeconds))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = 0

  return speakerScript.segments.map((segment, index) => {
    const start = roundSeconds(cursor)
    const end = index === segmentCount - 1
      ? totalDuration
      : roundSeconds(Math.min(totalDuration, cursor + totalDuration * weights[index] / totalWeight))

    cursor = end

    return {
      end: Math.max(start + 0.001, end),
      slideId: segment.slideId,
      start,
    }
  })
}

function createTextPlanQualityReport(input: {
  mediaInfo: MediaInfo
  narration: Narration
  selectedMoments: LongVideoSelectedMoments
  storyboard: Storyboard
  timeline: Timeline
}): TextDeckProjectPlan['qualityReport'] {
  const issues = createTextQualityIssues(input)

  return {
    checkedAt: new Date().toISOString(),
    issues,
    narrationSegments: input.narration.segments.length,
    summary: summarizeQualityIssues(issues),
    ttsSegments: 0,
    version: 1,
  }
}

function estimateTextDeckSlideCount(text: string, durationTargetSeconds: number | undefined): number {
  if (durationTargetSeconds !== undefined) {
    return clampInteger(Math.round(durationTargetSeconds / 22), 4, 14)
  }

  return clampInteger(Math.ceil(text.length / 900), 4, 12)
}

function estimateNarrationCharactersPerSlide(durationTargetSeconds: number | undefined, slideCount: number): number {
  if (durationTargetSeconds === undefined) {
    return 110
  }

  return clampInteger(Math.round(durationTargetSeconds / Math.max(1, slideCount) * 4.5), 60, 150)
}

function estimateNarrationDuration(text: string): number {
  return Math.max(4, Math.ceil(text.length / 12))
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function chunk<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, size)
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += safeSize) {
    chunks.push(items.slice(index, index + safeSize))
  }

  return chunks
}

function truncateForLLM(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text
  }

  return `${text.slice(0, maxCharacters)}\n\n[truncated ${text.length - maxCharacters} characters]`
}

function cleanGeneratedText(value: string | undefined, fallback: string): string {
  const cleaned = stripMarkdownControlText(value ?? '')
    .replaceAll(/^第\s*\d+\s*页[：:]\s*/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()

  return cleaned === '' ? fallback : cleaned
}

function stripMarkdownControlText(value: string): string {
  return value
    .replaceAll(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n?/u, '')
    .replaceAll(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replaceAll(/```/g, '')
    .split('\n')
    .map((line) => line
      .replace(/^#{1,6}\s+/u, '')
      .replace(/^[-*+]\s+/u, '')
      .replace(/^>\s*/u, '')
      .replace(/\|/g, ' ')
      .trim())
    .filter((line) => line !== '---')
    .join('\n')
    .trim()
}

function createTextMediaInfo(inputPath: string, duration: number): MediaInfo {
  return {
    duration,
    formatName: 'text/plain',
    inputPath,
    probedAt: new Date().toISOString(),
    streams: [],
    version: 1,
  }
}

function inferDocumentSourceType(inputPath: string): Document['source']['sourceType'] {
  const extension = extname(inputPath).toLowerCase()

  if (extension === '.md' || extension === '.markdown') {
    return 'markdown'
  }

  if (extension === '.html' || extension === '.htm') {
    return 'html'
  }

  if (extension === '.pdf') {
    return 'pdf'
  }

  return 'text'
}

function isAudioInputPath(inputPath: string): boolean {
  return ['.aac', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.weba'].includes(extname(inputPath).toLowerCase())
}

function normalizeDeckTheme(theme: string | undefined): Deck['theme'] {
  if (theme === undefined || theme === 'auto') {
    return DEFAULT_DECK_THEME
  }

  if (DECK_THEMES.includes(theme as Deck['theme'])) {
    return theme as Deck['theme']
  }

  throw new Error(`Unsupported deck theme "${theme}". Expected one of: ${DECK_THEMES.join(', ')}.`)
}

function resolveTheme(llmTheme: string | undefined, optionTheme: string | undefined): Deck['theme'] {
  if (optionTheme !== undefined && optionTheme !== 'auto') {
    return normalizeDeckTheme(optionTheme)
  }

  if (llmTheme !== undefined && DECK_THEMES.includes(llmTheme as Deck['theme'])) {
    return llmTheme as Deck['theme']
  }

  return DEFAULT_DECK_THEME
}

function defaultSlideMotion(index: number, type: DeckSlideType | undefined): Slide['motion'] {
  if (index === 0 || type === 'hero') {
    return 'cinematic-rise'
  }

  if (type === 'comparison') {
    return 'card-stack'
  }

  if (type === 'timeline' || type === 'process') {
    return 'progressive-reveal'
  }

  if (type === 'stat') {
    return 'number-count'
  }

  return 'progressive-reveal'
}

function visualKindForSlideType(type: DeckSlideType): DeckVisual['kind'] {
  if (type === 'hero') {
    return 'title-card'
  }

  if (type === 'chart' || type === 'stat') {
    return 'chart'
  }

  if (type === 'code') {
    return 'code'
  }

  if (type === 'process' || type === 'timeline') {
    return 'process'
  }

  return 'text'
}

function createTimedDeck(deck: Deck, timings: SlideTiming[]): TimedDeck {
  return {
    deck,
    timings,
    version: 1,
  }
}

function createTextTimeline(duration: number): Timeline {
  return {
    duration,
    fps: 30,
    items: [],
    version: 1,
  }
}

function createDeckNarrationFromSpeakerScript(speakerScript: SpeakerScript, timedDeck: TimedDeck): Narration {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))

  return {
    language: speakerScript.language,
    segments: speakerScript.segments.map((segment, index) => {
      const timing = timingBySlide.get(segment.slideId)

      return {
        duration: segment.estimatedDuration ?? (timing === undefined ? 1 : Math.max(0.1, timing.end - timing.start)),
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing?.start ?? index,
        text: segment.text,
      }
    }),
    version: 1,
  }
}

function createSlideTimingsFromTts(speakerScript: SpeakerScript, timedDeck: TimedDeck, ttsSegments: TTSSegment[]): SlideTiming[] {
  let cursor = 0

  return speakerScript.segments.map((segment, index) => {
    const fallbackTiming = timedDeck.timings.find((timing) => timing.slideId === segment.slideId)
    const fallbackDuration = segment.estimatedDuration ?? (fallbackTiming === undefined ? 1 : fallbackTiming.end - fallbackTiming.start)
    const duration = roundSeconds(Math.max(0.1, ttsSegments[index]?.duration ?? fallbackDuration))
    const start = roundSeconds(cursor)
    const end = roundSeconds(start + duration)

    cursor = end

    return {
      end,
      slideId: segment.slideId,
      start,
    }
  })
}

function createDeckNarrationFromTimings(speakerScript: SpeakerScript, timings: SlideTiming[]): Narration {
  const timingBySlide = new Map(timings.map((timing) => [timing.slideId, timing]))

  return {
    language: speakerScript.language,
    segments: speakerScript.segments.map((segment, index) => {
      const timing = timingBySlide.get(segment.slideId)

      return {
        duration: timing === undefined ? segment.estimatedDuration ?? 1 : roundSeconds(timing.end - timing.start),
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing?.start ?? index,
        text: segment.text,
      }
    }),
    version: 1,
  }
}

function updateStoryboardTiming(storyboard: Storyboard, narration: Narration, timings: SlideTiming[]): Storyboard {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene, index) => {
      const timing = timings[index]
      const narrationSegment = narration.segments[index]

      if (timing === undefined) {
        return scene
      }

      return {
        ...scene,
        duration: roundSeconds(timing.end - timing.start),
        narration: narrationSegment?.text ?? scene.narration,
        sourceRange: [timing.start, timing.end],
        start: timing.start,
      }
    }),
  }
}

function updateSelectedMomentsTiming(selectedMoments: LongVideoSelectedMoments, timings: SlideTiming[]): LongVideoSelectedMoments {
  return {
    ...selectedMoments,
    moments: selectedMoments.moments.map((moment, index) => {
      const timing = timings[index]

      return timing === undefined ? moment : {
        ...moment,
        sourceRange: [timing.start, timing.end],
      }
    }),
  }
}

async function renderDeckVoiceover(projectDir: string, ttsSegments: TTSSegment[], outputPath: string): Promise<void> {
  if (ttsSegments.length === 0) {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      '0.1',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return
  }

  const inputArgs = ttsSegments.flatMap((segment) => ['-i', resolve(projectDir, segment.path)])
  const concatInputs = ttsSegments.map((_, index) => `[${index}:a]`).join('')

  await runFfmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex',
    `${concatInputs}concat=n=${ttsSegments.length}:v=0:a=1[aout]`,
    '-map',
    '[aout]',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ])
}

async function readReusableDeckFrameManifest(workspace: ProjectWorkspace, expected: {
  fps: number
  outputDir: string
  sourceSha256: string
}): Promise<ReusableDeckFrameManifest | undefined> {
  try {
    const manifest = DeckFrameManifestReuseSchema.parse(await workspace.store.readJson('deck-frame-manifest.json'))
    const matches = manifest.fps === expected.fps
      && manifest.outputDir === toProjectPath(workspace.projectDir, expected.outputDir)
      && manifest.sourceSha256 === expected.sourceSha256

    return matches ? manifest : undefined
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    return undefined
  }
}

function resolveDeckFinalizeOnlyManifest(input: {
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

function createDeckFrameCaptureFromManifest(input: {
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

function deckFrameVideoRenderer(backend: DeckHtmlFrameSequenceCaptureBackend): 'chromium+ffmpeg' | 'playwright+ffmpeg' {
  return backend === 'playwright' ? 'playwright+ffmpeg' : 'chromium+ffmpeg'
}

async function assertCompleteDeckFrameSequence(projectDir: string, frames: CaptureDeckHtmlFrameSequenceResult['frames']): Promise<void> {
  const missingFrames = await findMissingDeckFrameFiles(projectDir, frames)

  if (missingFrames.length === 0) {
    return
  }

  const examples = missingFrames
    .slice(0, 5)
    .map((frame) => `${frame.frame}:${toProjectPath(projectDir, frame.path)}`)
    .join(', ')

  throw new Error(`Deck frame sequence is incomplete: ${missingFrames.length} missing or empty frame(s). First missing frames: ${examples}`)
}

async function findMissingDeckFrameFiles(projectDir: string, frames: CaptureDeckHtmlFrameSequenceResult['frames']): Promise<Array<{frame: number; path: string}>> {
  const missing: Array<{frame: number; path: string}> = []

  for (const frame of frames) {
    const path = resolveProjectPath(projectDir, frame.path)

    try {
      // eslint-disable-next-line no-await-in-loop
      const info = await stat(path)

      if (info.size <= 0) {
        missing.push({frame: frame.frame, path})
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        missing.push({frame: frame.frame, path})
        continue
      }

      throw error
    }
  }

  return missing
}

function createPlannedDeckFrameManifest(input: {
  concurrency: number
  fps: number
  outputDir: string
  projectDir: string
  renderer: DeckHtmlFrameSequenceCaptureBackend
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
    source: 'timed-deck.json',
    sourceSha256: input.sourceSha256,
    version: 1 as const,
    viewport: deckCanvasSize(input.timedDeck.deck.format),
  }
}

function createDeckFrameManifest(input: {
  frameCapture: Awaited<ReturnType<typeof captureDeckHtmlFrameSequence>>
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
    source: 'timed-deck.json',
    sourceSha256: input.sourceSha256,
    version: 1 as const,
    viewport: input.frameCapture.viewport,
  }
}

function normalizeDeckFrameConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DECK_FRAME_CONCURRENCY
  }

  return Math.max(1, Math.floor(value))
}

function normalizeDeckFrameShardSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_DECK_FRAME_SHARD_SIZE
  }

  return Math.max(1, Math.floor(value))
}

function normalizeDeckShardConcurrency(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 1
  }

  return Math.max(1, Math.floor(value))
}

function normalizeDeckShardRetries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function normalizeDeckShardRetryDelayMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

function normalizeDeckRendererFps(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_DECK_RENDER_FPS
  }

  return Math.max(1, Math.floor(value))
}

function normalizeDeckFrameRange(options: Pick<CreateDeckFinalRenderProjectOptions, 'frameEnd' | 'frameStart'>): {end?: number; start?: number} | undefined {
  if (options.frameStart === undefined && options.frameEnd === undefined) {
    return undefined
  }

  const start = options.frameStart === undefined || !Number.isFinite(options.frameStart) ? undefined : Math.max(1, Math.floor(options.frameStart))
  const end = options.frameEnd === undefined || !Number.isFinite(options.frameEnd) ? undefined : Math.max(1, Math.floor(options.frameEnd))

  if (start !== undefined && end !== undefined && end < start) {
    throw new RangeError(`--frame-end (${end}) must be greater than or equal to --frame-start (${start}).`)
  }

  return {end, start}
}

function createDeckFrameShardRanges(frameCount: number, frameShardSize: number): Array<{end: number; start: number}> {
  const ranges: Array<{end: number; start: number}> = []

  for (let start = 1; start <= frameCount; start += frameShardSize) {
    ranges.push({
      end: Math.min(frameCount, start + frameShardSize - 1),
      start,
    })
  }

  return ranges
}

async function runConcurrentMap<Input, Output>(items: Input[], concurrency: number, worker: (item: Input) => Promise<Output>): Promise<Output[]> {
  const results = new Array<Output>(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex

      nextIndex += 1
      const item = items[index]

      if (item === undefined) {
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(item)
    }
  }

  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, () => runWorker()))

  return results
}

async function retryDeckShardCapture<T>(input: {
  delayMs: number
  retries: number
  run: () => Promise<T>
}): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= input.retries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await input.run()
    } catch (error) {
      lastError = error

      if (attempt >= input.retries) {
        break
      }

      if (input.delayMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(input.delayMs)
      }
    }
  }

  throw lastError
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await bunFile(path).bytes()).digest('hex')
}

function createDeckFrameCaptureFromFrames(input: {
  backend: DeckHtmlFrameSequenceCaptureBackend
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

function createDeckFrameShardArtifact(input: {
  frameCapture: Awaited<ReturnType<typeof captureDeckHtmlFrameSequence>>
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
    source: 'timed-deck.json',
    sourceSha256: input.sourceSha256,
    version: 1 as const,
  }
}

function createDeckRendererBackendArtifact(input: {
  backend: DeckRendererBackend
  backendProject: MotionCanvasDeckProject | RemotionDeckProject
  motionTimeline: MotionTimeline
  projectDir: string
  projectId: string
  sourceSha256: string
}) {
  const files = input.backend === 'remotion'
    ? remotionProjectFiles(input.projectDir, input.backendProject as RemotionDeckProject)
    : motionCanvasProjectFiles(input.projectDir, input.backendProject as MotionCanvasDeckProject)
  const height = 'height' in input.backendProject ? input.backendProject.height : undefined
  const width = 'width' in input.backendProject ? input.backendProject.width : undefined

  return {
    backend: input.backend,
    commandCwd: toProjectPath(input.projectDir, input.backendProject.outputDir),
    files,
    fps: input.backendProject.fps,
    generatedAt: new Date().toISOString(),
    ...(height === undefined ? {} : {height}),
    motionTimelinePath: files.motion,
    motionTrackCount: input.motionTimeline.tracks.length,
    outputDir: toProjectPath(input.projectDir, input.backendProject.outputDir),
    previewCommand: ['bun', 'run', 'preview'],
    projectId: input.projectId,
    renderCommand: ['bun', 'run', 'render'],
    source: 'timed-deck.json' as const,
    sourceSha256: input.sourceSha256,
    version: 1 as const,
    ...(width === undefined ? {} : {width}),
  }
}

function remotionProjectFiles(projectDir: string, project: RemotionDeckProject): Record<string, string> {
  return {
    composition: toProjectPath(projectDir, project.compositionPath),
    data: toProjectPath(projectDir, project.dataPath),
    entry: toProjectPath(projectDir, project.entryPath),
    motion: toProjectPath(projectDir, project.motionPath),
    package: toProjectPath(projectDir, project.packagePath),
  }
}

function motionCanvasProjectFiles(projectDir: string, project: MotionCanvasDeckProject): Record<string, string> {
  return {
    data: toProjectPath(projectDir, project.dataPath),
    motion: toProjectPath(projectDir, project.motionPath),
    package: toProjectPath(projectDir, project.packagePath),
    project: toProjectPath(projectDir, project.projectPath),
    scene: toProjectPath(projectDir, project.scenePath),
  }
}

async function removeDeckHtmlFrameArtifacts(workspace: ProjectWorkspace): Promise<void> {
  await Promise.all([
    rm(resolve(workspace.rendersDir, 'deck-frames'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'deck-keyframes'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'html'), {force: true, recursive: true}),
    rm(resolve(workspace.rendersDir, 'html-shards'), {force: true, recursive: true}),
  ])

  const artifactNames = await readdir(workspace.artifactsDir).catch(() => [])
  const staleArtifacts = artifactNames.filter((name) =>
    name === 'deck-frame-manifest.json'
    || name === 'deck-frame-shard-plan.json'
    || name === 'deck-frame-shard-batch.json'
    || name === 'deck-keyframes.json'
    || /^deck-frame-shard-\d{6}-\d{6}\.json$/.test(name),
  )

  await Promise.all(staleArtifacts.map((name) => rm(resolve(workspace.artifactsDir, name), {force: true})))
}

async function writeDeckSubtitles(workspace: ProjectWorkspace, timedDeck: TimedDeck): Promise<{
  outputPath: string
  quality: SubtitleQualityResult
}> {
  const narration = NarrationSchema.parse(await workspace.store.readJson('narration.json'))
  const outputPath = resolve(workspace.rendersDir, 'subtitles.srt')
  const cues = narrationToSrtCues(narration)

  await bunWrite(outputPath, narrationToSrt(narration))
  await workspace.store.writeJson('subtitles.json', {
    cues: cues.length,
    format: 'srt' as const,
    generatedAt: new Date().toISOString(),
    path: toProjectPath(workspace.projectDir, outputPath),
    version: 1 as const,
  })

  return {
    outputPath,
    quality: checkSrtSubtitles(await bunFile(outputPath).text(), {
      expectedCues: narration.segments.length,
      maxEnd: timedDeck.timings.at(-1)?.end ?? 0,
    }),
  }
}

async function createDeckKeyframeQuality(workspace: ProjectWorkspace, frameCapture: Awaited<ReturnType<typeof captureDeckHtmlFrameSequence>>, browserKeyframes?: CaptureDeckHtmlKeyframesResult): Promise<{
  artifact: {
    captureMode: 'browser-keyframes' | 'frame-sequence'
    duration: number
    fps: number
    generatedAt: string
    renderer: DeckHtmlKeyframeCaptureBackend
    samples: DeckKeyframeSample[]
    source: 'deck-frame-manifest.json'
    version: 1
    viewport: {height: number; width: number}
  }
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

interface DeckKeyframeTarget {
  frame: number
  label: string
  path: string
  slideId: string
  time: number
}

interface DeckKeyframeSample extends DeckKeyframeTarget {
  capturedAt: string
  error?: string
  ok: boolean
  sha256?: string
  size?: number
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

function toVisualFrameSample(sample: DeckKeyframeSample): VisualFrameSample {
  return {
    capturedAt: sample.capturedAt,
    ...(sample.error === undefined ? {} : {error: sample.error}),
    ok: sample.ok,
    path: sample.path,
    ...(sample.sha256 === undefined ? {} : {sha256: sample.sha256}),
    ...(sample.size === undefined ? {} : {size: sample.size}),
    timestamp: sample.time,
  }
}

async function renderDeckFrameSequenceVideo(framePattern: string, fps: number, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-framerate',
    String(fps),
    '-i',
    framePattern,
    '-an',
    '-vf',
    'format=yuv420p',
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-movflags',
    '+faststart',
    outputPath,
  ])
}

async function muxDeckFinalVideo(input: {
  audioPath: string
  outputPath: string
  silentVideoPath: string
  subtitlePath: string
}): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    input.silentVideoPath,
    '-i',
    input.audioPath,
    '-i',
    input.subtitlePath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-map',
    '2:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-c:s',
    'mov_text',
    '-shortest',
    '-movflags',
    '+faststart',
    input.outputPath,
  ])
}

async function inspectDeckRenderedOutput(outputPath: string, options: {expectedDuration: number}) {
  try {
    return checkRenderedMedia(await probeMedia(outputPath), {
      expectAudio: true,
      expectedDuration: options.expectedDuration,
    })
  } catch (error) {
    return createRenderedMediaProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

function toProjectPath(projectDir: string, path: string): string {
  return path.startsWith(`${projectDir}/`) ? path.slice(projectDir.length + 1) : path
}

function resolveProjectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path)
}

function createTextQualityIssues(input: {
  mediaInfo: MediaInfo
  narration: Narration
  selectedMoments: LongVideoSelectedMoments
  storyboard: Storyboard
  timeline: Timeline
}): QualityIssue[] {
  return [
    ...checkStoryboardConsistency(input.storyboard, input.mediaInfo),
    ...checkTimelineBounds(input.timeline),
    ...checkNarrationTiming(input.narration, input.timeline),
    ...checkExplainerStructure(input),
  ]
}

function createClaimsFromDocument(document: Document): Claims {
  const claimBlocks = document.blocks.filter((block) => ['claim', 'data', 'recommendation', 'summary'].includes(block.type))

  return {
    claims: claimBlocks.map((block, index): Claim => ({
      blockId: block.id,
      confidence: confidenceForContentBlock(block),
      evidence: block.evidence,
      id: `claim-${String(index + 1).padStart(3, '0')}`,
      text: block.text,
      type: block.type as Claim['type'],
    })),
    version: 1,
  }
}

function createSourceQuotesFromDocument(document: Document): SourceQuotes {
  return {
    quotes: document.blocks.map((block, index): SourceQuote => ({
      blockId: block.id,
      evidence: block.evidence,
      id: `quote-${String(index + 1).padStart(3, '0')}`,
      ...(block.sourceRange === undefined ? {} : {sourceRange: block.sourceRange}),
      text: block.text,
    })),
    version: 1,
  }
}

function confidenceForContentBlock(block: ContentBlock): number {
  if (block.evidence.length > 0) {
    return 0.9
  }

  if (block.type === 'data') {
    return 0.8
  }

  if (block.type === 'summary') {
    return 0.75
  }

  return 0.7
}

function createDeckQualityReport(timedDeck: TimedDeck): DeckQualityReport {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const issues: DeckQualityIssue[] = []
  const motion = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)
  const metrics = timedDeck.deck.slides.map((slide) => {
    const timing = timingBySlide.get(slide.slideId)
    const duration = timing === undefined ? 0 : roundSeconds(timing.end - timing.start)
    const metric = createDeckSlideQualityMetrics(slide, duration)

    issues.push(...createDeckSlideQualityIssues(slide, metric, timedDeck.deck.format))

    if (timing === undefined) {
      issues.push({
        code: 'deck.slide_timing_missing',
        message: `Slide ${slide.slideId} has no timing entry.`,
        severity: 'error',
        slideId: slide.slideId,
      })
    }

    return metric
  })

  issues.push(...createDeckTimingQualityIssues(timedDeck.timings))
  issues.push(...createDuplicateSlideQualityIssues(timedDeck.deck.slides))

  const textCharacters = metrics.map((metric) => metric.textCharacters)

  return {
    checkedAt: new Date().toISOString(),
    format: timedDeck.deck.format,
    issues,
    metrics,
    motion: {
      trackCount: motion.summary.trackCount,
      tracksPerSlide: motion.summary.slides.map((slide) => ({
        presets: slide.presets,
        slideId: slide.slideId,
        trackCount: slide.trackCount,
        ...(slide.transitionIn === undefined ? {} : {transitionIn: slide.transitionIn}),
        ...(slide.transitionOut === undefined ? {} : {transitionOut: slide.transitionOut}),
      })),
      transitionCount: motion.summary.transitionCount,
    },
    renderEstimate: {
      estimatedFrames: Math.ceil(motion.duration * motion.timeline.fps),
      estimatedRenderSeconds: roundSeconds(motion.duration * estimateDeckRenderSecondsPerSecond(timedDeck.deck.format)),
      fps: motion.timeline.fps,
    },
    source: 'timed-deck.json',
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      slides: timedDeck.deck.slides.length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
    templateDistribution: createTemplateDistribution(timedDeck.deck.slides),
    textDensity: {
      averageCharacters: textCharacters.length === 0 ? 0 : roundSeconds(textCharacters.reduce((sum, value) => sum + value, 0) / textCharacters.length),
      dense: metrics.filter((metric) => metric.density === 'dense').length,
      maxCharacters: Math.max(0, ...textCharacters),
      normal: metrics.filter((metric) => metric.density === 'normal').length,
      quiet: metrics.filter((metric) => metric.density === 'quiet').length,
    },
    version: 1,
  }
}

function createDeckSlideQualityMetrics(slide: Slide, duration: number): DeckSlideQualityMetrics {
  const textCharacters = deckSlideText(slide).length

  return {
    density: deckTextDensity(textCharacters),
    duration,
    estimatedCharactersPerSecond: duration <= 0 ? 0 : roundSeconds(textCharacters / duration),
    pointCount: slide.points.length,
    slideId: slide.slideId,
    template: slide.type,
    textCharacters,
    titleCharacters: slide.title.length,
  }
}

function createDeckSlideQualityIssues(slide: Slide, metric: DeckSlideQualityMetrics, format: DeckFormat): DeckQualityIssue[] {
  const issues: DeckQualityIssue[] = [...createDeckTemplateQualityIssues(slide)]
  const maxTitleCharacters = format === 'portrait_1080x1920' ? 34 : 48
  const maxTextCharacters = format === 'portrait_1080x1920' ? 180 : 240

  if (metric.titleCharacters > maxTitleCharacters) {
    issues.push({
      code: 'deck.title_too_long',
      message: `Slide ${slide.slideId} title has ${metric.titleCharacters} characters; target is ${maxTitleCharacters} or fewer for ${format}.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.textCharacters > maxTextCharacters) {
    issues.push({
      code: 'deck.text_density_high',
      message: `Slide ${slide.slideId} has ${metric.textCharacters} text characters; target is ${maxTextCharacters} or fewer for ${format}.`,
      severity: metric.textCharacters > maxTextCharacters * 1.5 ? 'error' : 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.pointCount > 4) {
    issues.push({
      code: 'deck.too_many_points',
      message: `Slide ${slide.slideId} has ${metric.pointCount} points; target is 4 or fewer.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.duration > 0 && metric.duration < 2) {
    issues.push({
      code: 'deck.slide_too_short',
      message: `Slide ${slide.slideId} duration is ${metric.duration}s; target is at least 2s for readability.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.estimatedCharactersPerSecond > 18) {
    issues.push({
      code: 'deck.reading_rate_high',
      message: `Slide ${slide.slideId} has an estimated reading rate of ${metric.estimatedCharactersPerSecond} characters/s.`,
      severity: metric.estimatedCharactersPerSecond > 28 ? 'error' : 'warning',
      slideId: slide.slideId,
    })
  }

  if (slide.type === 'chart' && slide.visual?.chartDataRef === undefined && slide.evidence.length === 0) {
    issues.push({
      code: 'deck.chart_missing_source',
      message: `Slide ${slide.slideId} is a chart slide without chartDataRef or evidence.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  if (slide.type === 'comparison' && (
    slide.comparison === undefined ||
    slide.comparison.left.points.length === 0 ||
    slide.comparison.right.points.length === 0
  )) {
    issues.push({
      code: 'deck.comparison_incomplete',
      message: `Slide ${slide.slideId} is a comparison slide without complete left and right comparison points.`,
      severity: 'error',
      slideId: slide.slideId,
    })
  }

  if (slide.type === 'stat' && slide.stat === undefined) {
    issues.push({
      code: 'deck.stat_missing_data',
      message: `Slide ${slide.slideId} is a stat slide without stat data.`,
      severity: 'error',
      slideId: slide.slideId,
    })
  }

  if (slide.type === 'stat' && slide.stat !== undefined && slide.points.length === 0 && slide.stat.caption === undefined) {
    issues.push({
      code: 'deck.stat_missing_context',
      message: `Slide ${slide.slideId} is a stat slide without supporting points or caption.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  return issues
}

function createDeckTemplateQualityIssues(slide: Slide): DeckQualityIssue[] {
  return validateSlideAgainstTemplateManifest(slide).map((message): DeckQualityIssue => ({
    code: 'deck.template.manifest_violation',
    message,
    severity: 'error',
    slideId: slide.slideId,
  }))
}

function deckTextDensity(textCharacters: number): DeckSlideQualityMetrics['density'] {
  if (textCharacters >= 180) {
    return 'dense'
  }

  if (textCharacters <= 72) {
    return 'quiet'
  }

  return 'normal'
}

function createTemplateDistribution(slides: Slide[]): Record<string, number> {
  const distribution: Record<string, number> = {}

  for (const slide of slides) {
    distribution[slide.type] = (distribution[slide.type] ?? 0) + 1
  }

  return distribution
}

function estimateDeckRenderSecondsPerSecond(format: DeckFormat): number {
  if (format === 'portrait_1080x1920') {
    return 0.65
  }

  if (format === 'square_1080x1080') {
    return 0.5
  }

  return 0.55
}

function createDeckTimingQualityIssues(timings: SlideTiming[]): DeckQualityIssue[] {
  const issues: DeckQualityIssue[] = []
  const sorted = [...timings].sort((left, right) => left.start - right.start)

  sorted.forEach((timing, index) => {
    const previous = sorted[index - 1]

    if (previous !== undefined && timing.start < previous.end) {
      issues.push({
        code: 'deck.timing_overlap',
        message: `Slide ${timing.slideId} starts before the previous slide ends.`,
        severity: 'error',
        slideId: timing.slideId,
      })
    }

    if (previous !== undefined && timing.start - previous.end > 0.25) {
      issues.push({
        code: 'deck.timing_gap',
        message: `Slide ${timing.slideId} starts ${roundSeconds(timing.start - previous.end)}s after the previous slide ends.`,
        severity: 'warning',
        slideId: timing.slideId,
      })
    }
  })

  return issues
}

function createDuplicateSlideQualityIssues(slides: Slide[]): DeckQualityIssue[] {
  const seen = new Map<string, string>()
  const issues: DeckQualityIssue[] = []

  for (const slide of slides) {
    const key = deckSlideText(slide).toLowerCase()
    const previousSlideId = seen.get(key)

    if (previousSlideId !== undefined) {
      issues.push({
        code: 'deck.duplicate_slide',
        message: `Slide ${slide.slideId} duplicates the visible text of ${previousSlideId}.`,
        severity: 'warning',
        slideId: slide.slideId,
      })
    } else {
      seen.set(key, slide.slideId)
    }
  }

  return issues
}

function deckSlideText(slide: Slide): string {
  return [slide.title, slide.subtitle, ...deckSlideContentParts(slide)].filter((value): value is string => value !== undefined).join(' ').trim()
}

function deckSlideContentParts(slide: Slide): string[] {
  return [
    ...slide.points,
    ...(slide.comparison === undefined ? [] : [
      slide.comparison.left.label,
      ...slide.comparison.left.points,
      slide.comparison.right.label,
      ...slide.comparison.right.points,
    ]),
    ...(slide.quote === undefined ? [] : [slide.quote.text, slide.quote.attribution].filter((value): value is string => value !== undefined)),
    ...(slide.stat === undefined ? [] : [slide.stat.value, slide.stat.label, slide.stat.caption].filter((value): value is string => value !== undefined)),
    ...(slide.code === undefined ? [] : [slide.code.language, slide.code.text]),
  ]
}

function summarizeQualityIssues(issues: QualityIssue[]): {errors: number; warnings: number} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

function normalizeText(value: string): string {
  return value.replaceAll(/\r\n?/g, '\n').replaceAll(/[ \t]+/g, ' ').trim()
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

import type {PipelineEvent} from '@video-agent/core'
import type {ASRResult, ASRSegment, CharacterIndex, ClipPlan, ClipPlanItem, FilmScenes, LongVideoAnalysisFrames, MediaInfo, MediaStream, Narration, NarrativeBeat, NarrativeBeats, OutputNarration, OutputTimelineMap, SilencePeriods, SourceManifest, StoryIndex, TimelineFusion, VLMAnalysis} from '@video-agent/ir'
import type {LLMTraceRecorder} from '@video-agent/llm'
import type {ProviderSet, SceneFrameBatch, Transcript, TTSSegment, VLMScene} from '@video-agent/providers'
import type {QualityIssue} from '@video-agent/quality'

import type {JobStore} from '@video-agent/db'
import {ASRResultSchema, CharacterIndexSchema, ClipPlanSchema, FilmScenesSchema, LongVideoAnalysisFramesSchema, NarrationSchema, NarrativeBeatsSchema, OutputNarrationSchema, OutputTimelineMapSchema, SilencePeriodsSchema, SourceManifestSchema, StoryIndexSchema, TimelineFusionSchema, VLMAnalysisSchema} from '@video-agent/ir'
import {createJsonlLLMTraceRecorder} from '@video-agent/llm'
import {extractAudio, extractVideoFrame, inspectAudioVolume, probeMedia, runFfmpeg, runProcess} from '@video-agent/media'
import {TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {checkAudioLoudness, checkNarrationTiming, checkRenderedMedia, checkSrtSubtitles, checkTtsCoverage, createAudioLoudnessProbeFailure, createRenderedMediaProbeFailure} from '@video-agent/quality'
import {narrationToSrt, narrationToSrtCues} from '@video-agent/renderer-ffmpeg'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {appendFile, mkdir, rename, unlink} from 'node:fs/promises'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'

import {refreshArtifactManifest} from './artifact-store.js'
import {bunFile, bunWrite} from './bun-runtime.js'
import {readConfig} from './config.js'
import {assertFileExists, readOptionalJson} from './file-io.js'
import {assertPipelineCheckpointArtifacts} from './job-runner.js'
import {createConfiguredJobStore} from './job-store.js'
import {FILM_PIPELINE_DEFINITION, FILM_PIPELINE_STAGES, type FilmPipelineStage, assertPipelineStage} from './pipeline-definitions.js'
import {createJsonlProviderCallRecorder, instrumentProviders, type ProviderCallRecorder} from './provider-calls.js'
import {createRuntimeProviders} from './runtime-providers.js'
import {createProjectWorkspace, type ProjectWorkspace} from './workspace.js'

export interface CreateFilmIngestProjectOptions {
  inputPath: string
  projectId?: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateFilmIngestProjectResult {
  artifacts: {
    mediaInfo: string
    sourceManifest: string
  }
  projectDir: string
  projectId: string
  sourceManifest: SourceManifest
  status: 'ingested'
}

export interface CreateFilmUnderstandingProjectOptions {
  maxScenes?: number
  projectId: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateFilmUnderstandingProjectResult {
  artifacts: {
    asrResult: string
    frames: string
    scenes: string
    silencePeriods: string
    timelineFusion: string
    vlmAnalysis: string
  }
  projectDir: string
  projectId: string
  scenes: number
  status: 'understood'
}

export interface CreateFilmStoryIndexProjectOptions {
  language?: string
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmStoryIndexProjectResult {
  artifacts: {
    characterIndex: string
    narrativeBeats: string
    storyIndex: string
  }
  beats: number
  projectDir: string
  projectId: string
  status: 'indexed'
}

export interface CreateFilmClipPlanProjectOptions {
  projectId: string
  targetDurationSeconds?: number
  workspaceDir?: string
}

export interface CreateFilmClipPlanProjectResult {
  artifacts: {
    clipPlan: string
  }
  clips: number
  duration: number
  projectDir: string
  projectId: string
  status: 'planned'
}

export interface CreateFilmCutProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmCutProjectResult {
  artifacts: {
    clipPlanValidated: string
    outputTimelineMap: string
  }
  outputPath: string
  projectDir: string
  projectId: string
  status: 'cut'
}

export interface CreateFilmOutputNarrationProjectOptions {
  language?: string
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmOutputNarrationProjectResult {
  artifacts: {
    narration: string
    outputNarration: string
  }
  projectDir: string
  projectId: string
  segments: number
  status: 'narrated'
}

export interface CreateFilmVoiceoverProjectOptions {
  projectId: string
  trace?: boolean
  workspaceDir?: string
}

export interface CreateFilmVoiceoverProjectResult {
  artifacts: {
    ttsSegments: string
  }
  projectDir: string
  projectId: string
  segments: number
  status: 'voiced'
  ttsSegments: TTSSegment[]
}

export interface CreateFilmAudioMixProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface FilmAudioMixVoiceover {
  delayMs: number
  duration: number
  narrationId: string
  path: string
  resolvedPath: string
  start: number
}

export interface FilmAudioMix {
  duration: number
  ducking?: {
    attackMs: number
    ratio: number
    releaseMs: number
    threshold: number
  }
  generatedAt: string
  mode: 'silence' | 'source-ducked' | 'source-only' | 'voiceover-only'
  outputPath: string
  sourceAudioRetained: boolean
  sourcePath: string
  version: 1
  voiceoverVolume: number
  sourceVolume: number
  voiceoverSegments: FilmAudioMixVoiceover[]
}

export interface CreateFilmAudioMixProjectResult {
  artifacts: {
    audioMix: string
  }
  audioMix: FilmAudioMix
  outputPath: string
  projectDir: string
  projectId: string
  status: 'mixed'
}

export interface CreateFilmSubtitleProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface FilmSubtitleOutput {
  cues: number
  format: 'srt'
  generatedAt: string
  path: string
  version: 1
}

export interface CreateFilmSubtitleProjectResult {
  artifacts: {
    subtitles: string
  }
  outputPath: string
  projectDir: string
  projectId: string
  status: 'subtitled'
  subtitles: FilmSubtitleOutput
}

export interface CreateFilmFinalRenderProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface CreateFilmFinalRenderProjectResult {
  artifactPath: string
  audioInputs: number
  outputPath: string
  projectDir: string
  projectId: string
  renderer: 'ffmpeg'
  status: 'rendered'
  subtitlePath: string
}

export interface CreateFilmQualityCheckProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface FilmQualityReport {
  checkedAt: string
  issues: QualityIssue[]
  narrationSegments: number
  summary: {
    errors: number
    warnings: number
  }
  ttsSegments: number
  version: 1
}

export interface CreateFilmQualityCheckProjectResult {
  artifactPath: string
  projectDir: string
  projectId: string
  qualityReport: FilmQualityReport
  status: 'checked'
}

export interface RunFilmRecapProjectOptions extends CreateFilmIngestProjectOptions {
  fromStage?: FilmPipelineStage
  maxScenes?: CreateFilmUnderstandingProjectOptions['maxScenes']
  targetDurationSeconds?: CreateFilmClipPlanProjectOptions['targetDurationSeconds']
}

export interface RunFilmRecapProjectResult {
  audioMix?: CreateFilmAudioMixProjectResult
  clipPlan?: CreateFilmClipPlanProjectResult
  completedStages: FilmPipelineStage[]
  cut?: CreateFilmCutProjectResult
  finalRender?: CreateFilmFinalRenderProjectResult
  fromStage: FilmPipelineStage
  ingest?: CreateFilmIngestProjectResult
  narration?: CreateFilmOutputNarrationProjectResult
  pipeline: 'film'
  projectDir: string
  projectId: string
  quality?: CreateFilmQualityCheckProjectResult
  status: 'completed' | 'failed'
  storyIndex?: CreateFilmStoryIndexProjectResult
  subtitle?: CreateFilmSubtitleProjectResult
  understanding?: CreateFilmUnderstandingProjectResult
  voiceover?: CreateFilmVoiceoverProjectResult
}

const FILM_STAGES = FILM_PIPELINE_STAGES
const LLM_TRACE_ARTIFACT_NAME = 'llm-traces.jsonl'

export async function runFilmRecapProject(options: RunFilmRecapProjectOptions): Promise<RunFilmRecapProjectResult> {
  const fromStage = options.fromStage ?? FILM_PIPELINE_DEFINITION.defaultRerunStage
  assertPipelineStage(FILM_PIPELINE_DEFINITION, fromStage)

  if (fromStage !== 'ingest' && options.projectId === undefined) {
    throw new Error('projectId is required when running a Film Recap project from a checkpoint stage.')
  }

  if (options.projectId !== undefined) {
    await assertPipelineCheckpointArtifacts(options.projectId, options.workspaceDir ?? '.video-agent', FILM_PIPELINE_DEFINITION, fromStage)
  }

  const common = {
    projectId: options.projectId,
    trace: options.trace,
    workspaceDir: options.workspaceDir,
  }
  const result: RunFilmRecapProjectResult = {
    completedStages: [],
    fromStage,
    pipeline: 'film',
    projectDir: '',
    projectId: options.projectId ?? '',
    status: 'completed',
  }
  const runStage = async <T>(stage: FilmPipelineStage, operation: () => Promise<T>): Promise<T | undefined> => {
    if (FILM_STAGES.indexOf(stage) < FILM_STAGES.indexOf(fromStage)) {
      return undefined
    }

    const output = await operation()
    const stageProject = output as {projectDir?: string; projectId?: string}
    result.completedStages.push(stage)
    result.projectDir = stageProject.projectDir ?? result.projectDir
    result.projectId = stageProject.projectId ?? result.projectId

    return output
  }

  result.ingest = await runStage('ingest', () => createFilmIngestProject({
    inputPath: options.inputPath,
    projectId: options.projectId,
    trace: options.trace,
    workspaceDir: options.workspaceDir,
  }))
  const projectId = result.projectId || options.projectId

  if (projectId === undefined || projectId === '') {
    throw new Error('Film Recap project id could not be resolved.')
  }

  const stageCommon = {
    ...common,
    projectId,
  }

  result.understanding = await runStage('understand-source', () => createFilmUnderstandingProject({
    ...stageCommon,
    maxScenes: options.maxScenes,
  }))
  result.storyIndex = await runStage('build-story-index', () => createFilmStoryIndexProject(stageCommon))
  result.clipPlan = await runStage('plan-clips', () => createFilmClipPlanProject({
    ...stageCommon,
    targetDurationSeconds: options.targetDurationSeconds,
  }))
  result.cut = await runStage('render-cut', () => createFilmCutProject(stageCommon))
  result.narration = await runStage('narrate-output', () => createFilmOutputNarrationProject(stageCommon))
  result.voiceover = await runStage('synthesize-voice', () => createFilmVoiceoverProject(stageCommon))
  result.audioMix = await runStage('mix-audio', () => createFilmAudioMixProject(stageCommon))
  result.subtitle = await runStage('subtitle', () => createFilmSubtitleProject(stageCommon))
  result.finalRender = await runStage('render-final', () => createFilmFinalRenderProject(stageCommon))
  result.quality = await runStage('quality-check', () => createFilmQualityCheckProject(stageCommon))
  result.status = result.quality?.qualityReport.summary.errors === undefined || result.quality.qualityReport.summary.errors === 0 ? 'completed' : 'failed'

  return result
}

async function startFilmStage(jobStore: JobStore, workspace: ProjectWorkspace, stage: FilmPipelineStage): Promise<void> {
  await appendFilmEvent(workspace, {
    attempt: 1,
    level: 'info',
    projectId: workspace.projectId,
    stage,
    time: new Date().toISOString(),
    type: 'stage:start',
  })
  await jobStore.updateStage(stage, 'running', undefined, 1)
}

async function completeFilmStage(jobStore: JobStore, workspace: ProjectWorkspace, stage: FilmPipelineStage): Promise<void> {
  await jobStore.updateStage(stage, 'completed', undefined, 1)
  await appendFilmEvent(workspace, {
    attempt: 1,
    level: 'info',
    projectId: workspace.projectId,
    stage,
    time: new Date().toISOString(),
    type: 'stage:complete',
  })
}

async function failFilmStage(jobStore: JobStore, workspace: ProjectWorkspace, stage: FilmPipelineStage, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)

  await jobStore.updateStage(stage, 'failed', message, 1)
  await appendFilmEvent(workspace, {
    attempt: 1,
    level: 'error',
    message,
    projectId: workspace.projectId,
    stage,
    time: new Date().toISOString(),
    type: 'stage:fail',
  })
}

async function appendFilmEvent(workspace: ProjectWorkspace, event: PipelineEvent): Promise<void> {
  await appendFile(workspace.store.resolve('pipeline-events.jsonl'), `${JSON.stringify(event)}\n`)
}

async function createFilmJobStore(projectId: string, workspaceDir: string): Promise<JobStore> {
  const resolvedWorkspaceDir = resolve(workspaceDir)
  const config = await readConfig(resolvedWorkspaceDir)
  const projectDir = resolve(resolvedWorkspaceDir, 'projects', projectId)

  return createConfiguredJobStore({
    config,
    projectDir,
    projectId,
    workspaceDir: resolvedWorkspaceDir,
  })
}

function createFilmLLMTrace(workspace: ProjectWorkspace, enabled: boolean | undefined): {path?: string; recorder?: LLMTraceRecorder} {
  if (enabled !== true) {
    return {}
  }

  const path = workspace.store.resolve(LLM_TRACE_ARTIFACT_NAME)

  return {
    path,
    recorder: createJsonlLLMTraceRecorder(path),
  }
}

function createFilmProviderCallRecorder(workspace: ProjectWorkspace): ProviderCallRecorder {
  return createJsonlProviderCallRecorder(workspace.store.resolve('provider-calls.jsonl'))
}

export async function createFilmIngestProject(options: CreateFilmIngestProjectOptions): Promise<CreateFilmIngestProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const jobStore = await createFilmJobStore(workspace.projectId, workspace.workspaceDir)

  await jobStore.initialize({
    inputPath,
    pipeline: FILM_PIPELINE_DEFINITION.kind,
    projectId: workspace.projectId,
    stages: FILM_STAGES,
  })
  await startFilmStage(jobStore, workspace, 'ingest')

  try {
    const [mediaInfo, sourceHash] = await Promise.all([
      probeMedia(inputPath),
      hashFile(inputPath),
    ])
    const sourceManifest = SourceManifestSchema.parse(createSourceManifest(mediaInfo, sourceHash))
    const artifacts = {
      mediaInfo: await workspace.store.writeJson('media-info.json', mediaInfo),
      sourceManifest: await workspace.store.writeJson('source-manifest.json', sourceManifest),
    }

    await completeFilmStage(jobStore, workspace, 'ingest')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      sourceManifest,
      status: 'ingested',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'ingest', error)
    throw error
  }
}

export async function createFilmUnderstandingProject(options: CreateFilmUnderstandingProjectOptions): Promise<CreateFilmUnderstandingProjectResult> {
  const projectId = options.projectId
  const jobStore = await createFilmJobStore(projectId, options.workspaceDir ?? '.video-agent')
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir: options.workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'understand-source')

  try {
    const config = await readConfig(workspace.workspaceDir)
    const llmTrace = createFilmLLMTrace(workspace, options.trace)
    const providers = instrumentProviders(
      await createRuntimeProviders(config, workspace.workspaceDir, {
        llmTrace: llmTrace.recorder,
      }),
      config.providers,
      createFilmProviderCallRecorder(workspace),
    )
    const sourceManifest = SourceManifestSchema.parse(await workspace.store.readJson('source-manifest.json'))
    const asrResult = ASRResultSchema.parse(await createFilmAsrResult(workspace.audioDir, sourceManifest, providers))
    const scenes = FilmScenesSchema.parse(createFilmScenesFromAsr(sourceManifest, asrResult, options.maxScenes ?? 12))
    const frames = LongVideoAnalysisFramesSchema.parse(await createFilmFrameManifest(workspace.framesDir, sourceManifest, scenes))
    const silencePeriods = SilencePeriodsSchema.parse(createFilmSilencePeriods(sourceManifest, asrResult))
    const vlmAnalysis = VLMAnalysisSchema.parse(await createFilmVlmAnalysis(sourceManifest, scenes, frames, providers))
    const timelineFusion = TimelineFusionSchema.parse(createTimelineFusion(sourceManifest, scenes, asrResult, silencePeriods, vlmAnalysis))
    const artifacts = {
      scenes: await workspace.store.writeJson('scenes.json', scenes),
      frames: await workspace.store.writeJson('frames.json', frames),
      asrResult: await workspace.store.writeJson('asr-result.json', asrResult),
      silencePeriods: await workspace.store.writeJson('silence-periods.json', silencePeriods),
      vlmAnalysis: await workspace.store.writeJson('vlm-analysis.json', vlmAnalysis),
      timelineFusion: await workspace.store.writeJson('timeline-fusion.json', timelineFusion),
    }

    await completeFilmStage(jobStore, workspace, 'understand-source')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      scenes: scenes.scenes.length,
      status: 'understood',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'understand-source', error)
    throw error
  }
}

export async function createFilmStoryIndexProject(options: CreateFilmStoryIndexProjectOptions): Promise<CreateFilmStoryIndexProjectResult> {
  const projectId = options.projectId
  const jobStore = await createFilmJobStore(projectId, options.workspaceDir ?? '.video-agent')
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir: options.workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'build-story-index')

  try {
    const [sourceManifest, timelineFusion, asrResult, vlmAnalysis] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      TimelineFusionSchema.parseAsync(await workspace.store.readJson('timeline-fusion.json')),
      ASRResultSchema.parseAsync(await workspace.store.readJson('asr-result.json')),
      VLMAnalysisSchema.parseAsync(await workspace.store.readJson('vlm-analysis.json')),
    ])
    const narrativeBeats = NarrativeBeatsSchema.parse(createNarrativeBeats(sourceManifest, timelineFusion, asrResult, vlmAnalysis))
    const characterIndex = CharacterIndexSchema.parse(createCharacterIndex(sourceManifest, narrativeBeats, vlmAnalysis))
    const storyIndex = StoryIndexSchema.parse(createStoryIndex(sourceManifest, narrativeBeats, characterIndex, options.language ?? 'zh-CN'))
    const artifacts = {
      storyIndex: await workspace.store.writeJson('story-index.json', storyIndex),
      narrativeBeats: await workspace.store.writeJson('narrative-beats.json', narrativeBeats),
      characterIndex: await workspace.store.writeJson('character-index.json', characterIndex),
    }

    await completeFilmStage(jobStore, workspace, 'build-story-index')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      beats: narrativeBeats.beats.length,
      projectDir: workspace.projectDir,
      projectId,
      status: 'indexed',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'build-story-index', error)
    throw error
  }
}

export async function createFilmClipPlanProject(options: CreateFilmClipPlanProjectOptions): Promise<CreateFilmClipPlanProjectResult> {
  const projectId = options.projectId
  const jobStore = await createFilmJobStore(projectId, options.workspaceDir ?? '.video-agent')
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir: options.workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'plan-clips')

  try {
    const [sourceManifest, storyIndex, asrResult] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      readOptionalFilmAsrResult(workspace),
    ])
    const clipPlan = ClipPlanSchema.parse(createFilmClipPlan(sourceManifest, storyIndex, options.targetDurationSeconds, asrResult))
    const artifacts = {
      clipPlan: await workspace.store.writeJson('clip-plan.json', clipPlan),
    }

    await completeFilmStage(jobStore, workspace, 'plan-clips')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      clips: clipPlan.clips.length,
      duration: clipPlan.duration,
      projectDir: workspace.projectDir,
      projectId,
      status: 'planned',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'plan-clips', error)
    throw error
  }
}

export async function createFilmCutProject(options: CreateFilmCutProjectOptions): Promise<CreateFilmCutProjectResult> {
  const projectId = options.projectId
  const jobStore = await createFilmJobStore(projectId, options.workspaceDir ?? '.video-agent')
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir: options.workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'render-cut')

  try {
    const [clipPlan, sourceManifest] = await Promise.all([
      ClipPlanSchema.parseAsync(await workspace.store.readJson('clip-plan.json')),
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
    ])
    const validatedClipPlan = ClipPlanSchema.parse(validateClipPlanForCut(clipPlan))
    const outputTimelineMap = OutputTimelineMapSchema.parse(createOutputTimelineMap(validatedClipPlan))
    const outputPath = resolve(workspace.rendersDir, 'edited_source.mp4')

    await renderCutVideo(validatedClipPlan, outputPath, sourceManifest.audioTracks > 0)

    const artifacts = {
      clipPlanValidated: await workspace.store.writeJson('clip-plan-validated.json', validatedClipPlan),
      outputTimelineMap: await workspace.store.writeJson('output-timeline-map.json', outputTimelineMap),
    }

    await completeFilmStage(jobStore, workspace, 'render-cut')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      status: 'cut',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'render-cut', error)
    throw error
  }
}

export async function createFilmOutputNarrationProject(options: CreateFilmOutputNarrationProjectOptions): Promise<CreateFilmOutputNarrationProjectResult> {
  const projectId = options.projectId
  const jobStore = await createFilmJobStore(projectId, options.workspaceDir ?? '.video-agent')
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir: options.workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'narrate-output')

  try {
    const [clipPlan, outputTimelineMap, storyIndex, asrResult] = await Promise.all([
      ClipPlanSchema.parseAsync(await workspace.store.readJson('clip-plan-validated.json')),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      readOptionalFilmAsrResult(workspace),
    ])
    const outputNarration = OutputNarrationSchema.parse(createOutputNarration(clipPlan, outputTimelineMap, storyIndex, asrResult, options.language ?? storyIndex.language))
    const narration = NarrationSchema.parse(createCompatibleNarration(outputNarration))
    const artifacts = {
      outputNarration: await workspace.store.writeJson('output-narration.json', outputNarration),
      narration: await workspace.store.writeJson('narration.json', narration),
    }

    await completeFilmStage(jobStore, workspace, 'narrate-output')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      segments: outputNarration.segments.length,
      status: 'narrated',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'narrate-output', error)
    throw error
  }
}

export async function createFilmVoiceoverProject(options: CreateFilmVoiceoverProjectOptions): Promise<CreateFilmVoiceoverProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const jobStore = await createFilmJobStore(projectId, workspaceDir)
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'synthesize-voice')

  try {
    const config = await readConfig(workspaceDir)
    const llmTrace = createFilmLLMTrace(workspace, options.trace)
    const providers = instrumentProviders(
      await createRuntimeProviders(config, workspaceDir, {
        llmTrace: llmTrace.recorder,
      }),
      config.providers,
      createFilmProviderCallRecorder(workspace),
    )
    const narration = NarrationSchema.parse(await workspace.store.readJson('narration.json'))
    const ttsSegments = TtsSegmentsSchema.parse(await providers.tts.synthesize(narration.segments, {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    }))
    const artifacts = {
      ttsSegments: await workspace.store.writeJson('tts-segments.json', ttsSegments),
    }

    await completeFilmStage(jobStore, workspace, 'synthesize-voice')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      segments: ttsSegments.length,
      status: 'voiced',
      ttsSegments,
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'synthesize-voice', error)
    throw error
  }
}

export async function createFilmAudioMixProject(options: CreateFilmAudioMixProjectOptions): Promise<CreateFilmAudioMixProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const jobStore = await createFilmJobStore(projectId, workspaceDir)
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'mix-audio')

  try {
    const [outputTimelineMap, narration, sourceManifest, ttsSegments] = await Promise.all([
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
      NarrationSchema.parseAsync(await workspace.store.readJson('narration.json')),
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      TtsSegmentsSchema.parseAsync(await workspace.store.readJson('tts-segments.json')),
    ])
    const outputPath = resolve(workspace.audioDir, 'audio_mix.wav')
    const editedSourcePath = resolve(workspace.rendersDir, 'edited_source.mp4')
    const sourceAudioPath = sourceManifest.audioTracks > 0 ? editedSourcePath : undefined
    const voiceoverSegments = await createAudioMixVoiceovers(workspace.projectDir, narration, ttsSegments)
    const mode = getAudioMixMode(sourceAudioPath !== undefined, voiceoverSegments.length > 0)
    const audioMix = {
      ...(mode === 'source-ducked' ? {
        ducking: {
          attackMs: 5,
          ratio: 8,
          releaseMs: 250,
          threshold: 0.03,
        },
      } : {}),
      duration: outputTimelineMap.outputDuration,
      generatedAt: new Date().toISOString(),
      mode,
      outputPath: toProjectReference(workspace.projectDir, outputPath),
      sourceAudioRetained: sourceAudioPath !== undefined,
      sourcePath: toProjectReference(workspace.projectDir, editedSourcePath),
      sourceVolume: 0.35,
      version: 1 as const,
      voiceoverVolume: 1,
      voiceoverSegments: voiceoverSegments.map((segment) => ({
        ...segment,
        resolvedPath: toProjectReference(workspace.projectDir, segment.resolvedPath),
      })),
    }

    if (sourceAudioPath !== undefined) {
      await assertFileExists(sourceAudioPath)
    }
    await renderAudioMix(outputPath, outputTimelineMap.outputDuration, sourceAudioPath, voiceoverSegments)

    const artifacts = {
      audioMix: await workspace.store.writeJson('audio-mix.json', audioMix),
    }

    await completeFilmStage(jobStore, workspace, 'mix-audio')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      audioMix,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      status: 'mixed',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'mix-audio', error)
    throw error
  }
}

export async function createFilmSubtitleProject(options: CreateFilmSubtitleProjectOptions): Promise<CreateFilmSubtitleProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const jobStore = await createFilmJobStore(projectId, workspaceDir)
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'subtitle')

  try {
    const narration = NarrationSchema.parse(await workspace.store.readJson('narration.json'))
    const outputPath = resolve(workspace.rendersDir, 'subtitles.srt')
    const cues = narrationToSrtCues(narration)

    await bunWrite(outputPath, narrationToSrt(narration))

    const subtitles = {
      cues: cues.length,
      format: 'srt' as const,
      generatedAt: new Date().toISOString(),
      path: toProjectReference(workspace.projectDir, outputPath),
      version: 1 as const,
    }
    const artifacts = {
      subtitles: await workspace.store.writeJson('subtitles.json', subtitles),
    }

    await completeFilmStage(jobStore, workspace, 'subtitle')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      status: 'subtitled',
      subtitles,
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'subtitle', error)
    throw error
  }
}

export async function createFilmFinalRenderProject(options: CreateFilmFinalRenderProjectOptions): Promise<CreateFilmFinalRenderProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const jobStore = await createFilmJobStore(projectId, workspaceDir)
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'render-final')

  try {
    const [audioMix, subtitles, outputTimelineMap] = await Promise.all([
      readFilmAudioMix(workspace.store.readJson('audio-mix.json')),
      readFilmSubtitles(workspace.store.readJson('subtitles.json')),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
    ])
    const editedSourcePath = resolve(workspace.rendersDir, 'edited_source.mp4')
    const audioMixPath = resolveProjectPath(workspace.projectDir, audioMix.outputPath)
    const subtitlePath = resolveProjectPath(workspace.projectDir, subtitles.path)
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')

    await Promise.all([
      assertFileExists(editedSourcePath),
      assertFileExists(audioMixPath),
      assertFileExists(subtitlePath),
    ])
    const finalRender = await renderFinalFilmVideo({
      audioMixPath,
      editedSourcePath,
      outputPath,
      subtitlePath,
    })

    const outputQuality = await inspectRenderedOutput(outputPath, {
      expectAudio: true,
      expectedDuration: outputTimelineMap.outputDuration,
    })
    const audioQuality = outputQuality.audioStreams > 0 ? await inspectRenderedAudio(outputPath) : undefined
    const subtitleQuality = withSubtitleBurnInWarning(checkSrtSubtitles(await bunFile(subtitlePath).text(), {
      expectedCues: subtitles.cues,
      maxEnd: outputTimelineMap.outputDuration,
    }), finalRender.subtitleBurnInIssue)
    const artifactPath = await workspace.store.writeJson('render-output.json', {
      audioInputs: 1,
      audioMixPath: audioMix.outputPath,
      ...(audioQuality === undefined ? {} : {audioQuality}),
      completedAt: new Date().toISOString(),
      outputPath: toProjectReference(workspace.projectDir, outputPath),
      outputQuality,
      renderer: 'ffmpeg' as const,
      source: toProjectReference(workspace.projectDir, editedSourcePath),
      subtitlePath: subtitles.path,
      subtitleQuality,
      ...(finalRender.subtitleBurnInIssue === undefined ? {} : {subtitleBurnInIssue: finalRender.subtitleBurnInIssue}),
      subtitlesBurned: finalRender.subtitlesBurned,
      version: 1 as const,
    })

    await completeFilmStage(jobStore, workspace, 'render-final')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      audioInputs: 1,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      renderer: 'ffmpeg',
      status: 'rendered',
      subtitlePath,
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'render-final', error)
    throw error
  }
}

export async function createFilmQualityCheckProject(options: CreateFilmQualityCheckProjectOptions): Promise<CreateFilmQualityCheckProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const jobStore = await createFilmJobStore(projectId, workspaceDir)
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'quality-check')

  try {
    const [renderOutput, narration, ttsSegments, outputTimelineMap] = await Promise.all([
      workspace.store.readJson('render-output.json') as Promise<FilmRenderOutputArtifact>,
      NarrationSchema.parseAsync(await workspace.store.readJson('narration.json')),
      TtsSegmentsSchema.parseAsync(await workspace.store.readJson('tts-segments.json')),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
    ])
    const timeline = {
      duration: outputTimelineMap.outputDuration,
      fps: 30,
      items: [],
      version: 1 as const,
    }
    const issues = [
      ...collectFilmRenderIssues(renderOutput),
      ...checkNarrationTiming(narration, timeline),
      ...checkTtsCoverage(narration, ttsSegments).filter((issue) => issue.code !== 'tts.duration.mismatch'),
      ...checkFilmTtsDurationBounds(narration, ttsSegments, outputTimelineMap.outputDuration),
    ]
    const qualityReport = {
      checkedAt: new Date().toISOString(),
      issues,
      narrationSegments: narration.segments.length,
      summary: {
        errors: issues.filter((issue) => issue.severity === 'error').length,
        warnings: issues.filter((issue) => issue.severity === 'warning').length,
      },
      ttsSegments: ttsSegments.length,
      version: 1 as const,
    }
    const artifactPath = await workspace.store.writeJson('quality-report.json', qualityReport)

    await completeFilmStage(jobStore, workspace, 'quality-check')
    await jobStore.complete(qualityReport.summary.errors === 0 ? 'completed' : 'failed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      projectDir: workspace.projectDir,
      projectId,
      qualityReport,
      status: 'checked',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'quality-check', error)
    throw error
  }
}

async function createAudioMixVoiceovers(projectDir: string, narration: Narration, ttsSegments: TTSSegment[]): Promise<FilmAudioMixVoiceover[]> {
  const narrationById = new Map(narration.segments.map((segment) => [segment.id, segment]))
  const voiceovers = ttsSegments.map((ttsSegment, index) => {
    const narrationSegment = narrationById.get(ttsSegment.narrationId) ?? narration.segments[index]
    const start = roundSeconds(narrationSegment?.start ?? 0)
    const duration = roundSeconds(ttsSegment.duration || narrationSegment?.duration || 0)
    const resolvedPath = resolveProjectPath(projectDir, ttsSegment.path)

    return {
      delayMs: Math.max(0, Math.round(start * 1000)),
      duration,
      narrationId: ttsSegment.narrationId,
      path: ttsSegment.path,
      resolvedPath,
      start,
    }
  })

  await Promise.all(voiceovers.map((voiceover) => assertFileExists(voiceover.resolvedPath)))

  return voiceovers
}

function getAudioMixMode(hasSourceAudio: boolean, hasVoiceover: boolean): FilmAudioMix['mode'] {
  if (hasSourceAudio && hasVoiceover) {
    return 'source-ducked'
  }

  if (hasSourceAudio) {
    return 'source-only'
  }

  if (hasVoiceover) {
    return 'voiceover-only'
  }

  return 'silence'
}

async function renderAudioMix(outputPath: string, duration: number, sourceAudioPath: string | undefined, voiceovers: FilmAudioMixVoiceover[]): Promise<void> {
  await mkdir(resolve(outputPath, '..'), {recursive: true})

  if (sourceAudioPath === undefined && voiceovers.length === 0) {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      String(Math.max(duration, 0.001)),
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return
  }

  const inputArgs = [
    ...(sourceAudioPath === undefined ? [] : ['-i', sourceAudioPath]),
    ...voiceovers.flatMap((voiceover) => ['-i', voiceover.resolvedPath]),
  ]
  const sourceFilter = sourceAudioPath === undefined
    ? []
    : [`[0:a:0]atrim=duration=${Math.max(duration, 0.001)},asetpts=PTS-STARTPTS,volume=0.35[source]`]
  const voiceoverInputOffset = sourceAudioPath === undefined ? 0 : 1
  const filters = voiceovers.map((voiceover, index) => {
    const segmentDuration = Math.max(voiceover.duration, 0.001)
    const inputIndex = index + voiceoverInputOffset

    return `[${inputIndex}:a]atrim=duration=${segmentDuration},asetpts=PTS-STARTPTS,adelay=${voiceover.delayMs}:all=1,volume=1[voice${index}]`
  })
  const filter = buildAudioMixFilter({
    duration,
    hasSourceAudio: sourceAudioPath !== undefined,
    sourceFilters: sourceFilter,
    voiceoverCount: voiceovers.length,
    voiceoverFilters: filters,
  })

  await runFfmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex',
    filter,
    '-map',
    '[mix]',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ])
}

function buildAudioMixFilter(options: {
  duration: number
  hasSourceAudio: boolean
  sourceFilters: string[]
  voiceoverCount: number
  voiceoverFilters: string[]
}): string {
  const duration = Math.max(options.duration, 0.001)
  const allFilters = [...options.sourceFilters, ...options.voiceoverFilters]

  if (options.hasSourceAudio && options.voiceoverCount === 0) {
    return `${allFilters.join(';')};[source]apad,atrim=duration=${duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[mix]`
  }

  const voiceLabels = Array.from({length: options.voiceoverCount}, (_, index) => `[voice${index}]`)

  if (!options.hasSourceAudio) {
    return `${allFilters.join(';')};${voiceLabels.join('')}amix=inputs=${options.voiceoverCount}:duration=longest:dropout_transition=0,apad,atrim=duration=${duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[mix]`
  }

  const voiceBus = options.voiceoverCount === 1
    ? `${voiceLabels[0]}anull[voicebus]`
    : `${voiceLabels.join('')}amix=inputs=${options.voiceoverCount}:duration=longest:dropout_transition=0[voicebus]`

  return [
    ...allFilters,
    voiceBus,
    `[voicebus]apad,atrim=duration=${duration},asplit=2[duckkey][voicemix]`,
    '[source][duckkey]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=250[ducked]',
    `[ducked][voicemix]amix=inputs=2:duration=longest:dropout_transition=0,apad,atrim=duration=${duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[mix]`,
  ].join(';')
}

async function renderFinalFilmVideo(options: {
  audioMixPath: string
  editedSourcePath: string
  outputPath: string
  subtitlePath: string
}): Promise<{subtitleBurnInIssue?: QualityIssue; subtitlesBurned: boolean}> {
  await mkdir(resolve(options.outputPath, '..'), {recursive: true})
  const subtitleBurnInIssue = await getSubtitleBurnInReadinessIssue(options.subtitlePath)

  if (subtitleBurnInIssue !== undefined) {
    await renderFinalFilmVideoAttempt(options, false)

    return {
      subtitleBurnInIssue,
      subtitlesBurned: false,
    }
  }

  try {
    await renderFinalFilmVideoAttempt(options, true)

    return {subtitlesBurned: true}
  } catch (error) {
    if (!isMissingSubtitleFilterError(error)) {
      throw error
    }

    await renderFinalFilmVideoAttempt(options, false)

    return {
      subtitleBurnInIssue: {
        code: 'subtitle.render.filter_unavailable',
        message: 'The ffmpeg subtitles filter is unavailable; subtitles were written as a sidecar file but not burned into final.mp4.',
        severity: 'warning',
      },
      subtitlesBurned: false,
    }
  }
}

async function renderFinalFilmVideoAttempt(options: {
  audioMixPath: string
  editedSourcePath: string
  outputPath: string
  subtitlePath: string
}, burnSubtitles: boolean): Promise<void> {
  const tempOutputPath = `${options.outputPath}.tmp-${process.pid}-${Date.now()}.mp4`
  const renderOptions = {
    ...options,
    outputPath: tempOutputPath,
  }

  try {
    await runFfmpeg(buildFinalFilmRenderArgs(renderOptions, burnSubtitles))
    await rename(tempOutputPath, options.outputPath)
  } catch (error) {
    await unlinkIfExists(tempOutputPath)
    throw error
  }
}

async function getSubtitleBurnInReadinessIssue(subtitlePath: string): Promise<QualityIssue | undefined> {
  const content = await bunFile(subtitlePath).text()

  if (!containsCjk(content)) {
    return undefined
  }

  if (await hasCjkSubtitleFont()) {
    return undefined
  }

  return {
    code: 'subtitle.render.cjk_font_unavailable',
    message: 'No reliable CJK subtitle font was found; subtitles were written as a sidecar file but not burned into final.mp4.',
    severity: 'warning',
  }
}

async function hasCjkSubtitleFont(): Promise<boolean> {
  try {
    const result = await runProcess(['fc-match', 'Noto Sans CJK SC'])

    if (result.code !== 0) {
      return false
    }

    return /(Noto\s*Sans\s*CJK|NotoSansCJK|Source\s*Han|WenQuanYi|Microsoft\s*YaHei|SimHei|PingFang|Hiragino|Songti|Kaiti)/iu.test(result.stdout)
  } catch {
    return false
  }
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }

    throw error
  }
}

function buildFinalFilmRenderArgs(options: {
  audioMixPath: string
  editedSourcePath: string
  outputPath: string
  subtitlePath: string
}, burnSubtitles: boolean): string[] {
  const videoCodecArgs = burnSubtitles
    ? [
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-pix_fmt',
        'yuv420p',
      ]
    : [
        '-c:v',
        'copy',
      ]

  return [
    '-y',
    '-i',
    options.editedSourcePath,
    '-i',
    options.audioMixPath,
    ...(burnSubtitles ? ['-vf', buildSubtitleBurnInFilter(options.subtitlePath)] : []),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    ...videoCodecArgs,
    '-c:a',
    'aac',
    '-shortest',
    options.outputPath,
  ]
}

function buildSubtitleBurnInFilter(subtitlePath: string): string {
  const style = [
    'FontName=Noto Sans CJK SC',
    'FontSize=18',
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H90000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    'Alignment=2',
    'MarginV=80',
  ].join(',')

  return `subtitles=filename='${escapeSubtitleFilterPath(subtitlePath)}':charenc=UTF-8:force_style='${escapeSubtitleFilterValue(style)}'`
}

function isMissingSubtitleFilterError(error: unknown): boolean {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.includes("No such filter: 'subtitles'")
}

function withSubtitleBurnInWarning<T extends {errors: number; issues: QualityIssue[]; warnings: number}>(quality: T, issue: QualityIssue | undefined): T {
  if (issue === undefined) {
    return quality
  }

  const issues = [
    ...quality.issues,
    issue,
  ]

  return {
    ...quality,
    issues,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

interface FilmRenderOutputArtifact {
  audioQuality?: {issues?: QualityIssue[]}
  outputQuality?: {issues?: QualityIssue[]}
  subtitleQuality?: {issues?: QualityIssue[]}
  visualQuality?: {issues?: QualityIssue[]}
}

function collectFilmRenderIssues(renderOutput: FilmRenderOutputArtifact): QualityIssue[] {
  return [
    ...(renderOutput.outputQuality?.issues ?? []),
    ...(renderOutput.subtitleQuality?.issues ?? []),
    ...(renderOutput.audioQuality?.issues ?? []),
    ...(renderOutput.visualQuality?.issues ?? []),
  ]
}

function checkFilmTtsDurationBounds(narration: Narration, ttsSegments: TTSSegment[], outputDuration: number, tolerance = 0.05): QualityIssue[] {
  const narrationById = new Map(narration.segments.map((segment) => [segment.id, segment]))
  const durationsByNarrationId = new Map<string, number>()

  for (const ttsSegment of ttsSegments) {
    durationsByNarrationId.set(ttsSegment.narrationId, (durationsByNarrationId.get(ttsSegment.narrationId) ?? 0) + Math.max(0, ttsSegment.duration))
  }

  return [...durationsByNarrationId.entries()].flatMap(([narrationId, ttsDuration]): QualityIssue[] => {
    const segment = narrationById.get(narrationId)

    if (segment?.start === undefined) {
      return []
    }

    const issues: QualityIssue[] = []

    if (segment.duration !== undefined && ttsDuration > segment.duration + tolerance) {
      issues.push({
        code: 'tts.segment.exceeds_narration',
        message: `TTS audio for narration ${narrationId} exceeds the narration segment duration.`,
        severity: 'warning',
      })
    }

    if (segment.start + ttsDuration > outputDuration + tolerance) {
      issues.push({
        code: 'tts.segment.out_of_bounds',
        message: `TTS audio for narration ${narrationId} exceeds the rendered output duration.`,
        severity: 'warning',
      })
    }

    return issues
  })
}

async function readFilmAudioMix(valuePromise: Promise<unknown>): Promise<FilmAudioMix> {
  const value = await valuePromise

  return value as FilmAudioMix & {outputPath: string}
}

async function readFilmSubtitles(valuePromise: Promise<unknown>): Promise<FilmSubtitleOutput> {
  const value = await valuePromise

  return value as FilmSubtitleOutput & {path: string}
}

async function readOptionalFilmAsrResult(workspace: ProjectWorkspace): Promise<ASRResult | undefined> {
  const value = await readOptionalJson<unknown>(workspace.store.resolve('asr-result.json'))

  return value === undefined ? undefined : ASRResultSchema.parse(value)
}

async function inspectRenderedOutput(outputPath: string, options: {expectAudio: boolean; expectedDuration: number}) {
  try {
    return checkRenderedMedia(await probeMedia(outputPath), options)
  } catch (error) {
    return createRenderedMediaProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

async function inspectRenderedAudio(outputPath: string) {
  try {
    return checkAudioLoudness(await inspectAudioVolume(outputPath))
  } catch (error) {
    return createAudioLoudnessProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

function escapeSubtitleFilterPath(path: string): string {
  return path.replaceAll('\\', String.raw`\\`).replaceAll(':', String.raw`\:`).replaceAll("'", String.raw`\'`)
}

function escapeSubtitleFilterValue(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)
}

function createSourceManifest(mediaInfo: MediaInfo, sourceHash: string): SourceManifest {
  const video = mediaInfo.streams.find((stream) => stream.type === 'video')

  return {
    audioTracks: mediaInfo.streams.filter((stream) => stream.type === 'audio').length,
    codecName: video?.codecName,
    duration: mediaInfo.duration ?? maxStreamDuration(mediaInfo.streams) ?? 0,
    fps: video?.fps,
    height: video?.height,
    orientation: getOrientation(video),
    sourceHash,
    sourcePath: mediaInfo.inputPath,
    version: 1,
    width: video?.width,
  }
}

function createOutputNarration(clipPlan: ClipPlan, outputTimelineMap: OutputTimelineMap, storyIndex: StoryIndex, asrResult: ASRResult | undefined, language: string): OutputNarration {
  const beatsById = new Map(storyIndex.beats.map((beat) => [beat.id, beat]))
  const clipsById = new Map(clipPlan.clips.map((clip) => [clip.id, clip]))

  return {
    language,
    segments: outputTimelineMap.clips.map((mappedClip, index) => {
      const clip = clipsById.get(mappedClip.clipId)
      const beat = clip?.beatId === undefined ? undefined : beatsById.get(clip.beatId)
      const start = roundSeconds(mappedClip.outputStart)
      const end = roundSeconds(mappedClip.outputEnd)
      const beatRef = beat?.id ?? clip?.sceneId ?? mappedClip.clipId
      const clipSourceRange = [mappedClip.sourceStart, mappedClip.sourceEnd] as [number, number]
      const asrSegments = collectAsrSegmentsForRange(asrResult, clipSourceRange)

      return {
        end,
        evidence: [beatRef, mappedClip.clipId, ...asrSegments.map((segment) => `asr-result.json#${segment.id}`)],
        id: `output-narration-${String(index + 1).padStart(3, '0')}`,
        overlapsSpeech: false,
        pauseAfterMs: index === outputTimelineMap.clips.length - 1 ? 0 : 250,
        start,
        text: createNarrationText(beat, clipSourceRange, asrSegments, index, language, end - start),
      }
    }),
    timeline: 'output',
    version: 1,
  }
}

function createCompatibleNarration(outputNarration: OutputNarration): Narration {
  return {
    language: outputNarration.language,
    segments: outputNarration.segments.map((segment) => ({
      duration: roundSeconds(segment.end - segment.start),
      id: segment.id,
      sceneId: segment.evidence[0],
      start: segment.start,
      text: segment.text,
    })),
    version: 1,
  }
}

function createNarrationText(beat: NarrativeBeat | undefined, clipSourceRange: [number, number], asrSegments: ASRSegment[], index: number, language: string, duration: number): string {
  const maxLength = maxNarrationCharactersForDuration(duration, language)
  const asrText = cleanNarrationText(asrSegments.map((segment) => segment.text).join(' '), language, maxLength)

  if (asrText !== '') {
    return asrText
  }

  if (beat === undefined) {
    return createFallbackNarrationText(index, language)
  }

  if (!rangeCoversRange(clipSourceRange, beat.sourceRange, 0.05)) {
    return createFallbackNarrationText(index, language)
  }

  const text = cleanNarrationText(beat.summary, language, maxLength)

  return text === '' ? createFallbackNarrationText(index, language) : text
}

function createFallbackNarrationText(index: number, language: string): string {
  if (isChineseLanguage(language)) {
    return index === 0 ? '这一段保留开场关键画面，交代故事背景。' : '这一段保留关键画面，推进故事发展。'
  }

  return index === 0 ? 'This segment keeps the key opening moment and sets up the story.' : 'This segment keeps a key moment that moves the story forward.'
}

function cleanNarrationText(text: string, language: string, maxLength = 260): string {
  const withoutSegmentLabel = text
    .replace(/^第\s*\d+\s*段\s*[，,.:：、-]?\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim()

  if (isChineseLanguage(language) && !containsCjk(withoutSegmentLabel)) {
    return ''
  }

  return trimToSentenceBoundary(withoutSegmentLabel, maxLength)
}

function maxNarrationCharactersForDuration(duration: number, language: string): number {
  if (isChineseLanguage(language)) {
    return Math.max(28, Math.min(260, Math.floor(duration * 5)))
  }

  return Math.max(48, Math.min(520, Math.floor(duration * 11)))
}

function collectAsrSegmentsForRange(asrResult: ASRResult | undefined, sourceRange: [number, number]): ASRSegment[] {
  if (asrResult === undefined || asrResult.timestampConfidence === 'untimed') {
    return []
  }

  return asrResult.segments
    .filter((segment) => {
      const overlap = rangeOverlapSeconds([segment.start, segment.end], sourceRange)

      return overlap > 0.05 && overlap >= Math.min(segment.end - segment.start, sourceRange[1] - sourceRange[0]) * 0.5
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

function isChineseLanguage(language: string): boolean {
  return language.toLowerCase().startsWith('zh')
}

function containsCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

function trimToSentenceBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  const sliced = text.slice(0, maxLength)
  const boundary = Math.max(
    sliced.lastIndexOf('。'),
    sliced.lastIndexOf('！'),
    sliced.lastIndexOf('？'),
    sliced.lastIndexOf('.'),
    sliced.lastIndexOf('!'),
    sliced.lastIndexOf('?'),
  )

  return (boundary >= Math.floor(maxLength * 0.45) ? sliced.slice(0, boundary + 1) : sliced).trim()
}

function validateClipPlanForCut(clipPlan: ClipPlan): ClipPlan {
  let outputCursor = 0
  const clips = clipPlan.clips.flatMap((clip) => {
    if (clip.duration <= 0 || clip.sourceRange[1] <= clip.sourceRange[0]) {
      return []
    }

    const duration = roundSeconds(clip.sourceRange[1] - clip.sourceRange[0])
    const start = roundSeconds(outputCursor)

    outputCursor = roundSeconds(outputCursor + duration)

    return [{
      ...clip,
      duration,
      start,
    }]
  })
  const duration = roundSeconds(clips.reduce((total, clip) => total + clip.duration, 0))

  return {
    ...clipPlan,
    clips,
    duration,
  }
}

function createOutputTimelineMap(clipPlan: ClipPlan): OutputTimelineMap {
  return {
    clips: clipPlan.clips.map((clip) => ({
      clipId: clip.id,
      outputEnd: roundSeconds(clip.start + clip.duration),
      outputStart: clip.start,
      sourceEnd: clip.sourceRange[1],
      sourceStart: clip.sourceRange[0],
    })),
    outputDuration: clipPlan.duration,
    source: clipPlan.source,
    version: 1,
  }
}

async function renderCutVideo(clipPlan: ClipPlan, outputPath: string, includeAudio: boolean): Promise<void> {
  if (clipPlan.clips.length === 0) {
    throw new Error('Cannot render cut because clip-plan.json contains no clips.')
  }

  const videoFilterParts = clipPlan.clips.map((clip, index) => {
    const [start, end] = clip.sourceRange

    return `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`
  })

  if (!includeAudio) {
    const concatInputs = clipPlan.clips.map((_, index) => `[v${index}]`).join('')
    const filter = `${videoFilterParts.join(';')};${concatInputs}concat=n=${clipPlan.clips.length}:v=1:a=0[outv]`

    await runFfmpeg([
      '-y',
      '-i',
      clipPlan.source,
      '-filter_complex',
      filter,
      '-map',
      '[outv]',
      '-an',
      '-c:v',
      'mpeg4',
      '-pix_fmt',
      'yuv420p',
      outputPath,
    ])
    return
  }

  const audioFilterParts = clipPlan.clips.map((clip, index) => {
    const [start, end] = clip.sourceRange

    return `[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`
  })
  const concatInputs = clipPlan.clips.map((_, index) => `[v${index}][a${index}]`).join('')
  const filter = `${[...videoFilterParts, ...audioFilterParts].join(';')};${concatInputs}concat=n=${clipPlan.clips.length}:v=1:a=1[outv][outa]`

  await runFfmpeg([
    '-y',
    '-i',
    clipPlan.source,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'mpeg4',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outputPath,
  ])
}

function createFilmClipPlan(sourceManifest: SourceManifest, storyIndex: StoryIndex, targetDuration: number | undefined, asrResult?: ASRResult): ClipPlan {
  const effectiveTarget = clamp(targetDuration ?? sourceManifest.duration, 0, sourceManifest.duration)
  const candidates = storyIndex.beats
    .flatMap((beat) => createClipCandidates(beat, sourceManifest.duration, asrResult))
    .sort((left, right) => right.priorityScore - left.priorityScore || left.granularityRank - right.granularityRank || left.sourceStart - right.sourceStart)
  const selected: Array<FilmClipCandidate & {selectionRank: number}> = []
  let selectedDuration = 0

  for (const [index, candidate] of candidates.entries()) {
    if (selectedDuration >= effectiveTarget - 0.001) {
      break
    }

    if (candidate.duration > effectiveTarget - selectedDuration + 0.001 || selected.some((selectedCandidate) => rangesOverlap(selectedCandidate.sourceRange, candidate.sourceRange))) {
      continue
    }

    selected.push({
      ...candidate,
      selectionRank: index + 1,
    })
    selectedDuration = roundSeconds(selectedDuration + candidate.duration)
  }

  const clips: ClipPlanItem[] = []
  let outputCursor = 0

  for (const candidate of selected.sort((left, right) => left.sourceStart - right.sourceStart)) {
    clips.push({
      beatId: candidate.beat.id,
      duration: candidate.duration,
      id: `clip-${String(clips.length + 1).padStart(3, '0')}`,
      priorityScore: candidate.priorityScore,
      reason: createClipReason(candidate),
      sceneId: candidate.beat.id,
      selectionRank: candidate.selectionRank,
      source: sourceManifest.sourcePath,
      sourceRange: candidate.sourceRange,
      start: roundSeconds(outputCursor),
    })
    outputCursor = roundSeconds(outputCursor + candidate.duration)
  }

  if (clips.length === 0 && sourceManifest.duration > 0 && effectiveTarget > 0) {
    const duration = roundSeconds(effectiveTarget)
    const firstBeat = storyIndex.beats
      .map((beat) => createClipCandidate(beat, sourceManifest.duration, 'fallback-partial'))
      .find((candidate): candidate is FilmClipCandidate => candidate !== undefined)
    const sourceStart = firstBeat?.sourceStart ?? 0
    const sourceEnd = roundSeconds(Math.min(sourceManifest.duration, sourceStart + duration))

    clips.push({
      beatId: firstBeat?.beat.id,
      duration: roundSeconds(sourceEnd - sourceStart),
      id: 'clip-001',
      priorityScore: firstBeat?.priorityScore,
      reason: firstBeat === undefined
        ? 'Fallback source clip because no semantic clip candidates were available.'
        : `Fallback partial clip from ${firstBeat.beat.id} because no complete semantic candidate fit the target duration.`,
      sceneId: firstBeat?.beat.id ?? 'source',
      source: sourceManifest.sourcePath,
      sourceRange: [sourceStart, sourceEnd],
      start: 0,
    })
    outputCursor = roundSeconds(sourceEnd - sourceStart)
  }

  return {
    clips,
    duration: roundSeconds(outputCursor),
    source: sourceManifest.sourcePath,
    sourceDuration: sourceManifest.duration,
    version: 1,
  }
}

interface FilmClipCandidate {
  asrSegmentIds: string[]
  beat: NarrativeBeat
  duration: number
  granularity: 'beat' | 'asr' | 'fallback-partial'
  granularityRank: number
  priorityScore: number
  sourceRange: [number, number]
  sourceStart: number
  summary: string
}

const FILM_BEAT_TYPE_WEIGHTS: Record<NarrativeBeat['type'], number> = {
  climax: 95,
  conflict: 75,
  decision: 90,
  inciting_incident: 85,
  resolution: 70,
  reversal: 100,
  setup: 55,
  transition: 25,
}

function createClipCandidates(beat: NarrativeBeat, sourceDuration: number, asrResult: ASRResult | undefined): FilmClipCandidate[] {
  const beatCandidate = createClipCandidate(beat, sourceDuration, 'beat')
  const asrCandidates = collectAsrSegmentsForRange(asrResult, normalizeSourceRange(beat.sourceRange, sourceDuration))
    .map((segment) => createAsrClipCandidate(beat, segment, sourceDuration))
    .filter((candidate): candidate is FilmClipCandidate => candidate !== undefined)

  return [
    ...(beatCandidate === undefined ? [] : [beatCandidate]),
    ...asrCandidates,
  ]
}

function createClipCandidate(beat: NarrativeBeat, sourceDuration: number, granularity: FilmClipCandidate['granularity']): FilmClipCandidate | undefined {
  const sourceStart = clamp(beat.sourceRange[0], 0, sourceDuration)
  const beatEnd = clamp(beat.sourceRange[1], sourceStart, sourceDuration)
  const duration = roundSeconds(beatEnd - sourceStart)

  if (duration <= 0) {
    return undefined
  }

  return {
    asrSegmentIds: [],
    beat,
    duration,
    granularity,
    granularityRank: granularityRank(granularity),
    priorityScore: scoreNarrativeBeatForClipPlanning(beat) + granularityScore(granularity),
    sourceRange: [roundSeconds(sourceStart), roundSeconds(beatEnd)],
    sourceStart,
    summary: beat.summary,
  }
}

function createAsrClipCandidate(beat: NarrativeBeat, segment: ASRSegment, sourceDuration: number): FilmClipCandidate | undefined {
  const sourceStart = clamp(segment.start, beat.sourceRange[0], Math.min(beat.sourceRange[1], sourceDuration))
  const sourceEnd = clamp(segment.end, sourceStart, Math.min(beat.sourceRange[1], sourceDuration))
  const duration = roundSeconds(sourceEnd - sourceStart)

  if (duration < 0.25) {
    return undefined
  }

  return {
    asrSegmentIds: [segment.id],
    beat,
    duration,
    granularity: 'asr',
    granularityRank: granularityRank('asr'),
    priorityScore: scoreNarrativeBeatForClipPlanning(beat) + granularityScore('asr'),
    sourceRange: [roundSeconds(sourceStart), roundSeconds(sourceEnd)],
    sourceStart,
    summary: segment.text,
  }
}

function normalizeSourceRange(range: [number, number], sourceDuration: number): [number, number] {
  const start = clamp(range[0], 0, sourceDuration)
  const end = clamp(range[1], start, sourceDuration)

  return [start, end]
}

function granularityRank(granularity: FilmClipCandidate['granularity']): number {
  switch (granularity) {
    case 'beat':
      return 0
    case 'asr':
      return 1
    case 'fallback-partial':
      return 2
  }
}

function granularityScore(granularity: FilmClipCandidate['granularity']): number {
  switch (granularity) {
    case 'beat':
      return 0
    case 'asr':
      return -4
    case 'fallback-partial':
      return -16
  }
}

function createClipReason(candidate: FilmClipCandidate): string {
  const source = candidate.granularity === 'asr' && candidate.asrSegmentIds.length > 0
    ? `ASR moment ${candidate.asrSegmentIds.join(', ')}`
    : `${candidate.beat.type} beat ${candidate.beat.id}`

  return `Selected ${source} with score ${candidate.priorityScore}: ${candidate.summary}`
}

function scoreNarrativeBeatForClipPlanning(beat: NarrativeBeat): number {
  const evidenceBonus = Math.min(24, beat.evidence.length * 4)
  const characterBonus = Math.min(12, beat.characters.length * 3)
  const summaryBonus = scoreFilmClipSummaryKeywords(beat.summary)

  return roundSeconds(FILM_BEAT_TYPE_WEIGHTS[beat.type] + evidenceBonus + characterBonus + summaryBonus)
}

function scoreFilmClipSummaryKeywords(summary: string): number {
  const normalized = summary.toLowerCase()
  let score = 0

  if (/(决定|选择|拒绝|答应|decision|choose|refuse|accept)/iu.test(normalized)) {
    score += 8
  }

  if (/(反转|真相|揭露|背叛|reveal|twist|betray|turns out)/iu.test(normalized)) {
    score += 10
  }

  if (/(线索|证据|钥匙|录音|照片|clue|evidence|key|recording|photo)/iu.test(normalized)) {
    score += 6
  }

  if (/(高潮|决战|爆发|climax|showdown)/iu.test(normalized)) {
    score += 8
  }

  return score
}

function createNarrativeBeats(sourceManifest: SourceManifest, timelineFusion: TimelineFusion, asrResult: ASRResult, vlmAnalysis: VLMAnalysis): NarrativeBeats {
  const asrById = new Map(asrResult.segments.map((segment) => [segment.id, segment]))
  const vlmById = new Map(vlmAnalysis.scenes.map((scene) => [scene.id, scene]))
  const beats: NarrativeBeat[] = timelineFusion.items.map((item, index) => {
    const asrSegments = item.asrSegmentIds.flatMap((id) => {
      const segment = asrById.get(id)

      return segment === undefined ? [] : [segment]
    })
    const vlmScenes = item.vlmAnalysisIds.flatMap((id) => {
      const scene = vlmById.get(id)

      return scene === undefined ? [] : [scene]
    })
    const evidenceText = [
      item.summary,
      ...asrSegments.map((segment) => segment.text),
      ...vlmScenes.flatMap((scene) => [
        scene.summary,
        ...scene.actions,
        ...scene.emotions,
        ...scene.relationships,
        ...scene.plotClues,
      ]),
    ].join(' ')
    const characters = uniqueStrings([
      ...vlmScenes.flatMap((scene) => scene.characters),
      ...extractCharacterHints(evidenceText),
    ])

    return {
      characters,
      evidence: item.evidence,
      id: `beat-${String(index + 1).padStart(3, '0')}`,
      sourceRange: item.sourceRange,
      summary: createBeatSummary(item.summary, asrSegments.map((segment) => segment.text), vlmScenes.map((scene) => scene.summary)),
      type: inferBeatTypeFromEvidence(evidenceText, index, timelineFusion.items.length),
    }
  })

  return {
    beats,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function createCharacterIndex(sourceManifest: SourceManifest, narrativeBeats: NarrativeBeats, vlmAnalysis: VLMAnalysis): CharacterIndex {
  const entries = new Map<string, {evidence: CharacterIndex['characters'][number]['evidence']; name: string; mentions: number}>()

  for (const scene of vlmAnalysis.scenes) {
    for (const name of [...scene.characters, ...extractCharacterHints(scene.summary)]) {
      const entry = entries.get(name) ?? {evidence: [], mentions: 0, name}

      entry.mentions += 1
      entry.evidence.push(...scene.evidence.slice(0, 2))
      entries.set(name, entry)
    }
  }

  for (const beat of narrativeBeats.beats) {
    for (const name of beat.characters) {
      const entry = entries.get(name) ?? {evidence: [], mentions: 0, name}

      entry.mentions += 1
      entry.evidence.push(...beat.evidence.slice(0, 2))
      entries.set(name, entry)
    }
  }

  return {
    characters: [...entries.values()]
      .sort((left, right) => right.mentions - left.mentions || left.name.localeCompare(right.name))
      .map((entry, index) => ({
        aliases: [],
        description: `${entry.name} appears in ${entry.mentions} evidence-backed beat(s).`,
        evidence: dedupeEvidence(entry.evidence).slice(0, 6),
        id: `character-${String(index + 1).padStart(3, '0')}`,
        name: entry.name,
      })),
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function createStoryIndex(sourceManifest: SourceManifest, narrativeBeats: NarrativeBeats, characterIndex: CharacterIndex, language: string): StoryIndex {
  return {
    beats: narrativeBeats.beats,
    characters: characterIndex.characters,
    language,
    source: sourceManifest.sourcePath,
    sourceDuration: sourceManifest.duration,
    version: 1,
  }
}

function inferBeatTypeFromEvidence(text: string, index: number, total: number): NarrativeBeat['type'] {
  const normalized = text.toLowerCase()

  if (/(反转|真相|揭露|背叛|reveal|twist|betray|turns out)/iu.test(normalized)) {
    return 'reversal'
  }

  if (/(决定|选择|答应|拒绝|decision|choose|chooses|refuse|accept)/iu.test(normalized)) {
    return 'decision'
  }

  if (/(冲突|争吵|追逐|攻击|威胁|confront|fight|attack|chase|threat|conflict)/iu.test(normalized)) {
    return 'conflict'
  }

  if (/(高潮|决战|爆发|climax|final|showdown)/iu.test(normalized)) {
    return 'climax'
  }

  if (/(结局|解决|离开|获救|resolution|resolved|ending|escape)/iu.test(normalized)) {
    return 'resolution'
  }

  if (total <= 1) {
    return 'setup'
  }

  if (index === 0) {
    return 'setup'
  }

  if (index === total - 1) {
    return 'resolution'
  }

  if (index === 1) {
    return 'inciting_incident'
  }

  if (index >= Math.floor(total * 0.75)) {
    return 'climax'
  }

  return 'conflict'
}

function createBeatSummary(fallback: string, asrTexts: string[], vlmSummaries: string[]): string {
  const asrText = asrTexts.map((item) => item.trim()).filter(Boolean).join(' ')
  const text = asrText === '' ? vlmSummaries.map((item) => item.trim()).filter(Boolean).join(' ') : asrText

  return text === '' ? fallback : trimToSentenceBoundary(text, 260)
}

interface VlmSemanticHints {
  actions: string[]
  characters: string[]
  emotions: string[]
  plotClues: string[]
  relationships: string[]
}

function extractVlmSemanticHints(description: string): VlmSemanticHints {
  return {
    actions: uniqueStrings([
      ...extractLabeledList(description, ['动作', '行动', 'action', 'actions']),
      ...extractKeywordHints(description, [
        ['追逐', 'chase'],
        ['争吵', 'argument'],
        ['攻击', 'attack'],
        ['发现线索', 'discovery'],
        ['逃离', 'escape'],
        ['对峙', 'confrontation'],
      ]),
    ]),
    characters: uniqueStrings([
      ...extractLabeledList(description, ['人物', '角色', 'characters', 'character']),
      ...extractCharacterHints(description),
    ]),
    emotions: uniqueStrings([
      ...extractLabeledList(description, ['情绪', 'emotion', 'emotions']),
      ...extractKeywordHints(description, [
        ['恐惧', 'fear'],
        ['紧张', 'tension'],
        ['愤怒', 'anger'],
        ['悲伤', 'sadness'],
        ['震惊', 'shock'],
        ['怀疑', 'suspicion'],
      ]),
    ]),
    plotClues: uniqueStrings([
      ...extractLabeledList(description, ['线索', '关键道具', 'plot clue', 'plot clues', 'clues']),
      ...extractKeywordHints(description, [
        ['真相', 'truth reveal'],
        ['秘密', 'secret'],
        ['钥匙', 'key object'],
        ['证据', 'evidence'],
        ['录音', 'recording'],
        ['照片', 'photo'],
      ]),
    ]),
    relationships: uniqueStrings([
      ...extractLabeledList(description, ['关系', 'relationship', 'relationships']),
      ...extractKeywordHints(description, [
        ['背叛', 'betrayal'],
        ['合作', 'alliance'],
        ['敌人', 'enemy'],
        ['朋友', 'friend'],
        ['家人', 'family'],
        ['恋人', 'lover'],
      ]),
    ]),
  }
}

function extractLabeledList(text: string, labels: string[]): string[] {
  const escapedLabels = labels.map((label) => escapeRegExp(label)).join('|')
  const pattern = new RegExp(`(?:${escapedLabels})\\s*[:：]\\s*([^。.;；\\n]+)`, 'giu')
  const values: string[] = []

  for (const match of text.matchAll(pattern)) {
    values.push(...splitHintList(match[1] ?? ''))
  }

  return values
}

function splitHintList(value: string): string[] {
  return value
    .split(/[,，、/|]/u)
    .map((item) => item.trim().replace(/^["'“”]+|["'“”]+$/gu, ''))
    .filter((item) => item.length > 0)
    .map((item) => item.slice(0, 48))
}

function extractKeywordHints(text: string, hints: Array<[string, string]>): string[] {
  return hints.flatMap(([keyword, label]) => text.includes(keyword) ? [label] : [])
}

function extractCharacterHints(text: string): string[] {
  const knownRoles = [
    '主角',
    '反派',
    '男主',
    '女主',
    '警察',
    '侦探',
    '医生',
    '老师',
    '母亲',
    '父亲',
    '丈夫',
    '妻子',
    '女孩',
    '男孩',
    '朋友',
  ]
  const englishRoles = [
    ['protagonist', 'protagonist'],
    ['villain', 'villain'],
    ['detective', 'detective'],
    ['police', 'police'],
    ['doctor', 'doctor'],
  ] as const

  return uniqueStrings([
    ...knownRoles.filter((role) => text.includes(role)),
    ...englishRoles.flatMap(([keyword, label]) => text.toLowerCase().includes(keyword) ? [label] : []),
  ])
}

function dedupeEvidence<T extends {ref: string; text?: string; type: string}>(items: T[]): T[] {
  const seen = new Set<string>()
  const output: T[] = []

  for (const item of items) {
    const key = `${item.type}:${item.ref}:${item.text ?? ''}`

    if (!seen.has(key)) {
      seen.add(key)
      output.push(item)
    }
  }

  return output
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function createFilmScenes(sourceManifest: SourceManifest, maxScenes: number): FilmScenes {
  const duration = sourceManifest.duration
  const sceneCount = duration <= 0 ? 0 : Math.max(1, Math.min(maxScenes, Math.ceil(duration / 30)))
  const sceneDuration = sceneCount === 0 ? 0 : duration / sceneCount

  return {
    scenes: Array.from({length: sceneCount}, (_, index) => {
      const start = roundSeconds(index * sceneDuration)
      const end = roundSeconds(index === sceneCount - 1 ? duration : (index + 1) * sceneDuration)

      return {
        id: `scene-${String(index + 1).padStart(3, '0')}`,
        sourceRange: [start, end],
        summary: `Source scene ${index + 1} from ${formatTime(start)} to ${formatTime(end)}.`,
      }
    }),
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

async function createFilmFrameManifest(framesDir: string, sourceManifest: SourceManifest, scenes: FilmScenes): Promise<LongVideoAnalysisFrames> {
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

async function createFilmAsrResult(audioDir: string, sourceManifest: SourceManifest, providers: ProviderSet): Promise<ASRResult> {
  if (sourceManifest.audioTracks === 0) {
    return createPlaceholderAsrResult()
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

function createFilmScenesFromAsr(sourceManifest: SourceManifest, asrResult: ASRResult, maxScenes: number): FilmScenes {
  const timedSegments = asrResult.segments
    .filter((segment) => segment.end > segment.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)

  if (timedSegments.length === 0 || asrResult.timestampConfidence === 'untimed') {
    return createFilmScenes(sourceManifest, maxScenes)
  }

  const groupCount = Math.max(1, Math.min(maxScenes, timedSegments.length))
  const groupSize = Math.ceil(timedSegments.length / groupCount)
  const scenes = Array.from({length: groupCount}, (_, index) => {
    const group = timedSegments.slice(index * groupSize, (index + 1) * groupSize)
    const start = roundSeconds(clamp(group[0]?.start ?? 0, 0, sourceManifest.duration))
    const end = roundSeconds(clamp(group.at(-1)?.end ?? start, start, sourceManifest.duration))
    const summary = group.map((segment) => segment.text).join(' ').slice(0, 180)

    return {
      id: `scene-${String(index + 1).padStart(3, '0')}`,
      sourceRange: [start, end] as [number, number],
      summary: summary === '' ? `Dialogue scene ${index + 1} from ${formatTime(start)} to ${formatTime(end)}.` : summary,
    }
  }).filter((scene) => scene.sourceRange[1] > scene.sourceRange[0])

  if (scenes.length === 0) {
    return createFilmScenes(sourceManifest, maxScenes)
  }

  return {
    scenes,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function createFilmSilencePeriods(sourceManifest: SourceManifest, asrResult: ASRResult): SilencePeriods {
  if (sourceManifest.audioTracks === 0) {
    return createPlaceholderSilencePeriods(sourceManifest)
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
      reason: timedSegments.length === 0 ? 'placeholder' : 'detected',
      start: roundSeconds(cursor),
    })
  }

  return {
    periods,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

async function createFilmVlmAnalysis(sourceManifest: SourceManifest, scenes: FilmScenes, frames: LongVideoAnalysisFrames, providers: ProviderSet): Promise<VLMAnalysis> {
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
    const fallbackFrame = frames.frames[index]?.path

    return {
      frames: matchingFrames.length === 0 && fallbackFrame !== undefined ? [fallbackFrame] : matchingFrames,
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
      const hints = extractVlmSemanticHints(providerScene.description)

      return {
        actions: hints.actions,
        characters: hints.characters,
        emotions: hints.emotions,
        evidence: providerScene.evidence.map((ref) => ({ref, text: providerScene.description, type: 'vlm' as const})),
        id: `vlm-${String(index + 1).padStart(3, '0')}`,
        plotClues: hints.plotClues,
        relationships: hints.relationships,
        sceneId: providerScene.sceneId,
        sourceRange,
        summary: providerScene.description,
      }
    }),
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function createPlaceholderAsrResult(): ASRResult {
  return {
    language: 'unknown',
    segments: [],
    text: '',
    timestampConfidence: 'untimed',
    version: 1,
  }
}

function createPlaceholderSilencePeriods(sourceManifest: SourceManifest): SilencePeriods {
  const periods = sourceManifest.audioTracks === 0 && sourceManifest.duration > 0
    ? [{
        end: sourceManifest.duration,
        id: 'silence-001',
        reason: 'no-audio' as const,
        start: 0,
      }]
    : []

  return {
    periods,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function createTimelineFusion(
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

function rangesOverlap(left: [number, number], right: [number, number]): boolean {
  return left[0] < right[1] && right[0] < left[1]
}

function rangeOverlapSeconds(left: [number, number], right: [number, number]): number {
  return Math.max(0, Math.min(left[1], right[1]) - Math.max(left[0], right[0]))
}

function rangeCoversRange(outer: [number, number], inner: [number, number], tolerance = 0): boolean {
  return outer[0] <= inner[0] + tolerance && outer[1] >= inner[1] - tolerance
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.floor(seconds % 60)

  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function resolveProjectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path)
}

function toProjectReference(projectDir: string, path: string): string {
  const name = relative(projectDir, path)

  if (name !== '' && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)) {
    return name.split(sep).join('/')
  }

  return path
}

function maxStreamDuration(streams: MediaStream[]): number | undefined {
  const durations = streams
    .map((stream) => stream.duration)
    .filter((duration): duration is number => duration !== undefined)

  return durations.length === 0 ? undefined : Math.max(...durations)
}

function getOrientation(video: MediaStream | undefined): SourceManifest['orientation'] {
  if (video?.width === undefined || video.height === undefined) {
    return 'unknown'
  }

  if (video.width > video.height) {
    return 'landscape'
  }

  if (video.height > video.width) {
    return 'portrait'
  }

  return 'square'
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

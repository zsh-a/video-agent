import type {PipelineEvent} from '@video-agent/core'
import type {ASRResult, ASRSegment, CharacterIndex, ClipPlan, ClipPlanItem, FilmScenes, LongVideoAnalysisFrames, MediaInfo, MediaStream, Narration, NarrativeBeat, NarrativeBeats, OutputNarration, OutputTimelineMap, RecapScript, RecapScriptSegment, SilencePeriods, SourceManifest, StoryIndex, TimelineFusion, VLMAnalysis} from '@video-agent/ir'
import type {LLMTraceRecorder} from '@video-agent/llm'
import type {ProviderSet, SceneFrameBatch, Transcript, TTSSegment, VLMScene} from '@video-agent/providers'
import type {QualityIssue} from '@video-agent/quality'

import type {JobStore} from '@video-agent/db'
import {ASRResultSchema, CharacterIndexSchema, ClipPlanSchema, FilmScenesSchema, LongVideoAnalysisFramesSchema, NarrationSchema, NarrativeBeatsSchema, OutputNarrationSchema, OutputTimelineMapSchema, RecapScriptSchema, SilencePeriodsSchema, SourceManifestSchema, StoryIndexSchema, TimelineFusionSchema, VLMAnalysisSchema} from '@video-agent/ir'
import {createJsonlLLMTraceRecorder} from '@video-agent/llm'
import {extractAudio, extractVideoFrame, inspectAudioVolume, probeMedia, runFfmpeg} from '@video-agent/media'
import {TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {checkAudioLoudness, checkNarrationTiming, checkRenderedMedia, checkSrtSubtitles, checkTtsCoverage, createAudioLoudnessProbeFailure, createRenderedMediaProbeFailure} from '@video-agent/quality'
import {narrationToSrt, narrationToSrtCues} from '@video-agent/renderer-ffmpeg'
import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {appendFile, mkdir, rename, unlink} from 'node:fs/promises'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'

import {refreshArtifactManifest} from './artifact-store.js'
import {bunFile, bunWrite} from './bun-runtime.js'
import {readConfig} from './config.js'
import {assertFileExists} from './file-io.js'
import {assertPipelineCheckpointArtifacts} from './job-runner.js'
import {createConfiguredJobStore} from './job-store.js'
import {FILM_PIPELINE_DEFINITION, FILM_PIPELINE_STAGES, type FilmPipelineStage, assertPipelineStage} from './pipeline-definitions.js'
import {createJsonlProviderCallRecorder, instrumentProviders, type ProviderCallRecorder} from './provider-calls.js'
import {createRuntimeProviders} from './runtime-providers.js'
import {findCjkSubtitleFont, findCjkSubtitleFontPath} from './subtitle-fonts.js'
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

export interface CreateFilmRecapScriptProjectOptions {
  projectId: string
  targetDurationSeconds?: number
  workspaceDir?: string
}

export interface CreateFilmRecapScriptProjectResult {
  artifacts: {
    recapScript: string
  }
  projectDir: string
  projectId: string
  segments: number
  status: 'scripted'
  totalEstimatedDuration: number
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
  loudnessNormalization: {
    loudnessRangeLufs: number
    targetIntegratedLufs: number
    truePeakDb: number
  }
  mode: 'silence' | 'source-ducked' | 'source-only' | 'voiceover-only'
  outputPath: string
  sourceAudioRetained: boolean
  sourcePath: string
  version: 1
  voiceoverVolume: number
  sourceVolume: number
  sourceVolumeDuringVoiceover?: number
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
  script?: CreateFilmRecapScriptProjectResult
  storyIndex?: CreateFilmStoryIndexProjectResult
  subtitle?: CreateFilmSubtitleProjectResult
  understanding?: CreateFilmUnderstandingProjectResult
  voiceover?: CreateFilmVoiceoverProjectResult
}

const FILM_STAGES = FILM_PIPELINE_STAGES
const LLM_TRACE_ARTIFACT_NAME = 'llm-traces.jsonl'
const FILM_AUDIO_LOUDNESS_NORMALIZATION = {
  loudnessRangeLufs: 11,
  targetIntegratedLufs: -18,
  truePeakDb: -1.5,
}
const FILM_TTS_DURATION_TOLERANCE_SECONDS = 0.05

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
  result.script = await runStage('write-script', () => createFilmRecapScriptProject({
    ...stageCommon,
    targetDurationSeconds: options.targetDurationSeconds,
  }))
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

export async function createFilmRecapScriptProject(options: CreateFilmRecapScriptProjectOptions): Promise<CreateFilmRecapScriptProjectResult> {
  const projectId = options.projectId
  const jobStore = await createFilmJobStore(projectId, options.workspaceDir ?? '.video-agent')
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir: options.workspaceDir,
  })

  await startFilmStage(jobStore, workspace, 'write-script')

  try {
    const config = await readConfig(options.workspaceDir ?? '.video-agent')
    const providers = instrumentProviders(
      await createRuntimeProviders(config, options.workspaceDir ?? '.video-agent'),
      config.providers,
      createFilmProviderCallRecorder(workspace),
    )
    const [sourceManifest, storyIndex, asrResult, vlmAnalysis] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      ASRResultSchema.parseAsync(await workspace.store.readJson('asr-result.json')),
      VLMAnalysisSchema.parseAsync(await workspace.store.readJson('vlm-analysis.json')),
    ])
    const recapScript = validateGeneratedRecapScript(RecapScriptSchema.parse(await providers.script.createRecapScript({
      asrResult,
      sourceManifest,
      storyIndex,
      targetDurationSeconds: options.targetDurationSeconds,
      vlmAnalysis,
    })), storyIndex, sourceManifest, options.targetDurationSeconds)
    const artifacts = {
      recapScript: await workspace.store.writeJson('recap-script.json', recapScript),
    }

    await completeFilmStage(jobStore, workspace, 'write-script')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      segments: recapScript.segments.length,
      status: 'scripted',
      totalEstimatedDuration: recapScript.totalEstimatedDuration,
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'write-script', error)
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
    const [sourceManifest, storyIndex, asrResult, recapScript] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      ASRResultSchema.parseAsync(await workspace.store.readJson('asr-result.json')),
      RecapScriptSchema.parseAsync(await workspace.store.readJson('recap-script.json')),
    ])
    const clipPlan = ClipPlanSchema.parse(createFilmClipPlan(sourceManifest, storyIndex, options.targetDurationSeconds, asrResult, recapScript))
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
    const [clipPlan, outputTimelineMap, storyIndex, asrResult, recapScript] = await Promise.all([
      ClipPlanSchema.parseAsync(await workspace.store.readJson('clip-plan-validated.json')),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      ASRResultSchema.parseAsync(await workspace.store.readJson('asr-result.json')),
      RecapScriptSchema.parseAsync(await workspace.store.readJson('recap-script.json')),
    ])
    const outputNarration = OutputNarrationSchema.parse(createOutputNarration(clipPlan, outputTimelineMap, storyIndex, asrResult, options.language ?? storyIndex.language, recapScript))
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
    const ttsSegments = await alignFilmTtsSegmentsToNarration(workspace.projectDir, narration, TtsSegmentsSchema.parse(await providers.tts.synthesize(narration.segments, {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    })))
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
      loudnessNormalization: FILM_AUDIO_LOUDNESS_NORMALIZATION,
      mode,
      outputPath: toProjectReference(workspace.projectDir, outputPath),
      sourceAudioRetained: sourceAudioPath !== undefined,
      sourcePath: toProjectReference(workspace.projectDir, editedSourcePath),
      sourceVolume: sourceAudioPath !== undefined && voiceoverSegments.length > 0 ? 0.25 : 0.35,
      ...(sourceAudioPath !== undefined && voiceoverSegments.length > 0 ? {sourceVolumeDuringVoiceover: 0} : {}),
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

async function alignFilmTtsSegmentsToNarration(projectDir: string, narration: Narration, ttsSegments: TTSSegment[]): Promise<TTSSegment[]> {
  const narrationById = new Map(narration.segments.map((segment) => [segment.id, segment]))

  return Promise.all(ttsSegments.map(async (ttsSegment, index) => {
    const narrationSegment = narrationById.get(ttsSegment.narrationId) ?? narration.segments[index]
    const targetDuration = narrationSegment?.duration

    if (targetDuration === undefined || targetDuration <= 0 || ttsSegment.duration <= targetDuration + FILM_TTS_DURATION_TOLERANCE_SECONDS) {
      return ttsSegment
    }

    const path = resolveProjectPath(projectDir, ttsSegment.path)

    await assertFileExists(path)
    await conformAudioDuration(path, ttsSegment.duration, targetDuration)

    return {
      ...ttsSegment,
      duration: roundSeconds(targetDuration),
    }
  }))
}

async function conformAudioDuration(path: string, sourceDuration: number, targetDuration: number): Promise<void> {
  const tempOutputPath = `${path}.tmp-${process.pid}-${Date.now()}.wav`
  const tempo = sourceDuration / targetDuration
  const filter = [
    buildAtempoFilterChain(tempo),
    'apad',
    `atrim=duration=${roundSeconds(targetDuration)}`,
    'asetpts=PTS-STARTPTS',
  ].join(',')

  try {
    await runFfmpeg([
      '-y',
      '-i',
      path,
      '-filter:a',
      filter,
      '-ar',
      '48000',
      '-ac',
      '2',
      '-c:a',
      'pcm_s16le',
      tempOutputPath,
    ])
    await rename(tempOutputPath, path)
  } catch (error) {
    await unlinkIfExists(tempOutputPath)
    throw error
  }
}

function buildAtempoFilterChain(tempo: number): string {
  if (!Number.isFinite(tempo) || tempo <= 0) {
    return 'anull'
  }

  const tempos: number[] = []
  let remaining = tempo

  while (remaining > 2) {
    tempos.push(2)
    remaining /= 2
  }

  while (remaining < 0.5) {
    tempos.push(0.5)
    remaining /= 0.5
  }

  tempos.push(remaining)

  return tempos.map((value) => `atempo=${formatFilterNumber(value)}`).join(',')
}

function formatFilterNumber(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000)
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
    : [buildSourceAudioFilter(duration, voiceovers)]
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

function buildSourceAudioFilter(duration: number, voiceovers: FilmAudioMixVoiceover[]): string {
  const safeDuration = Math.max(duration, 0.001)

  if (voiceovers.length === 0) {
    return `[0:a:0]atrim=duration=${safeDuration},asetpts=PTS-STARTPTS,volume=0.35[source]`
  }

  const condition = voiceovers
    .map((voiceover) => {
      const start = roundSeconds(Math.max(0, voiceover.start))
      const end = roundSeconds(Math.max(start, voiceover.start + voiceover.duration))

      return `between(t,${start},${end})`
    })
    .join('+')
  const volumeExpression = escapeFfmpegFilterExpression(`if(gt(${condition},0),0,0.25)`)

  return `[0:a:0]atrim=duration=${safeDuration},asetpts=PTS-STARTPTS,volume=${volumeExpression}:eval=frame[source]`
}

function escapeFfmpegFilterExpression(value: string): string {
  return value.replaceAll(',', String.raw`\,`)
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
    return normalizeFilmAudioMix(`${allFilters.join(';')};[source]apad,atrim=duration=${duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[premix]`)
  }

  const voiceLabels = Array.from({length: options.voiceoverCount}, (_, index) => `[voice${index}]`)

  if (!options.hasSourceAudio) {
    return normalizeFilmAudioMix(`${allFilters.join(';')};${voiceLabels.join('')}amix=inputs=${options.voiceoverCount}:duration=longest:dropout_transition=0,apad,atrim=duration=${duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[premix]`)
  }

  const voiceBus = options.voiceoverCount === 1
    ? `${voiceLabels[0]}anull[voicebus]`
    : `${voiceLabels.join('')}amix=inputs=${options.voiceoverCount}:duration=longest:dropout_transition=0[voicebus]`

  return normalizeFilmAudioMix([
    ...allFilters,
    voiceBus,
    `[voicebus]apad,atrim=duration=${duration},asplit=2[duckkey][voicemix]`,
    '[source][duckkey]sidechaincompress=threshold=0.03:ratio=8:attack=5:release=250[ducked]',
    `[ducked][voicemix]amix=inputs=2:duration=longest:dropout_transition=0,apad,atrim=duration=${duration},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[premix]`,
  ].join(';'))
}

function normalizeFilmAudioMix(filter: string): string {
  return `${filter};[premix]loudnorm=I=${FILM_AUDIO_LOUDNESS_NORMALIZATION.targetIntegratedLufs}:TP=${FILM_AUDIO_LOUDNESS_NORMALIZATION.truePeakDb}:LRA=${FILM_AUDIO_LOUDNESS_NORMALIZATION.loudnessRangeLufs},aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[mix]`
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
    await renderFinalFilmVideoAttempt(options, 'subtitles')

    return {subtitlesBurned: true}
  } catch (error) {
    if (!isMissingSubtitleFilterError(error)) {
      throw error
    }

    try {
      await renderFinalFilmVideoAttempt(options, 'drawtext')

      return {subtitlesBurned: true}
    } catch (drawtextError) {
      if (!isMissingDrawtextFilterError(drawtextError)) {
        throw drawtextError
      }
    }

    await renderFinalFilmVideoAttempt(options, false)

    return {
      subtitleBurnInIssue: {
        code: 'subtitle.render.filters_unavailable',
        message: 'The ffmpeg subtitles and drawtext filters are unavailable; subtitles were written as a sidecar file but not burned into final.mp4.',
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
}, subtitleMode: false | 'drawtext' | 'subtitles'): Promise<void> {
  const tempOutputPath = `${options.outputPath}.tmp-${process.pid}-${Date.now()}.mp4`
  const renderOptions = {
    ...options,
    outputPath: tempOutputPath,
  }

  try {
    await runFfmpeg(await buildFinalFilmRenderArgs(renderOptions, subtitleMode))
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
  return await findCjkSubtitleFontPath() !== undefined
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

async function buildFinalFilmRenderArgs(options: {
  audioMixPath: string
  editedSourcePath: string
  outputPath: string
  subtitlePath: string
}, subtitleMode: false | 'drawtext' | 'subtitles'): Promise<string[]> {
  const videoFilter = subtitleMode === 'subtitles'
    ? await buildSubtitleBurnInFilter(options.subtitlePath)
    : subtitleMode === 'drawtext'
      ? await buildDrawtextSubtitleFilter(options.subtitlePath)
      : undefined
  const videoCodecArgs = videoFilter !== undefined
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
    ...(videoFilter === undefined ? [] : ['-vf', videoFilter]),
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

async function buildSubtitleBurnInFilter(subtitlePath: string): Promise<string> {
  const font = await findCjkSubtitleFont()
  const style = [
    `FontName=${font?.family ?? 'Noto Sans CJK SC'}`,
    'FontSize=18',
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H90000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    'Alignment=2',
    'MarginV=80',
  ].join(',')
  const fontsDir = font === undefined ? undefined : dirname(font.path)

  return [
    `subtitles=filename='${escapeSubtitleFilterPath(subtitlePath)}'`,
    ...(fontsDir === undefined ? [] : [`fontsdir='${escapeSubtitleFilterPath(fontsDir)}'`]),
    'charenc=UTF-8',
    `force_style='${escapeSubtitleFilterValue(style)}'`,
  ].join(':')
}

function isMissingSubtitleFilterError(error: unknown): boolean {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.includes("No such filter: 'subtitles'")
}

function isMissingDrawtextFilterError(error: unknown): boolean {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.includes("No such filter: 'drawtext'")
}

async function buildDrawtextSubtitleFilter(subtitlePath: string): Promise<string> {
  const fontPath = await findCjkSubtitleFontPath()
  const cues = parseSrtSubtitleCues(await bunFile(subtitlePath).text())

  if (cues.length === 0) {
    return 'null'
  }

  return cues.map((cue) => {
    const options = [
      ...(fontPath === undefined ? [] : [`fontfile='${escapeDrawtextValue(fontPath)}'`]),
      `text='${escapeDrawtextValue(cue.text)}'`,
      'x=(w-text_w)/2',
      'y=h-160',
      'fontsize=36',
      'fontcolor=white',
      'borderw=3',
      'bordercolor=black',
      `enable='between(t,${roundSeconds(cue.start)},${roundSeconds(cue.end)})'`,
    ]

    return `drawtext=${options.join(':')}`
  }).join(',')
}

function parseSrtSubtitleCues(content: string): Array<{end: number; start: number; text: string}> {
  return content
    .split(/\n\s*\n/u)
    .flatMap((block) => {
      const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
      const timing = lines.find((line) => line.includes('-->'))

      if (timing === undefined) {
        return []
      }

      const [startText, endText] = timing.split('-->').map((value) => value.trim())
      const start = parseSrtTime(startText)
      const end = parseSrtTime(endText)
      const text = lines.slice(lines.indexOf(timing) + 1).join('\n').trim()

      if (start === undefined || end === undefined || end <= start || text === '') {
        return []
      }

      return [{end, start, text}]
    })
}

function parseSrtTime(value: string | undefined): number | undefined {
  const match = value?.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/u)

  if (match === undefined || match === null) {
    return undefined
  }

  const [, hours, minutes, seconds, milliseconds] = match

  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000
}

function escapeDrawtextValue(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll("'", String.raw`\'`)
    .replaceAll(':', String.raw`\:`)
    .replaceAll(',', String.raw`\,`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('\n', String.raw`\n`)
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

function defaultRecapTargetDuration(sourceDuration: number): number {
  if (sourceDuration <= 0) {
    return 0
  }

  if (sourceDuration <= 90) {
    return sourceDuration
  }

  return roundSeconds(clamp(sourceDuration * 0.6, 90, 300))
}

function allocateDurationsBySourceRange(beats: Array<Pick<NarrativeBeat, 'sourceRange'>>, targetDuration: number): number[] {
  if (beats.length === 0) {
    return []
  }

  const sourceDurations = beats.map((beat) => Math.max(0, beat.sourceRange[1] - beat.sourceRange[0]))
  const totalSourceDuration = sourceDurations.reduce((total, duration) => total + duration, 0)

  if (targetDuration <= 0 || totalSourceDuration <= 0) {
    return beats.map(() => 0)
  }

  if (targetDuration >= totalSourceDuration) {
    return sourceDurations.map(roundSeconds)
  }

  const scale = targetDuration / totalSourceDuration
  const durations = sourceDurations.map((duration) => roundSeconds(Math.min(duration, duration * scale)))
  let difference = roundSeconds(targetDuration - durations.reduce((total, duration) => total + duration, 0))

  for (let index = durations.length - 1; index >= 0 && Math.abs(difference) >= 0.001; index -= 1) {
    const available = sourceDurations[index] - durations[index]
    const delta = difference > 0
      ? Math.min(available, difference)
      : Math.max(-durations[index], difference)

    durations[index] = roundSeconds(durations[index] + delta)
    difference = roundSeconds(difference - delta)
  }

  return durations
}

function validateGeneratedRecapScript(recapScript: RecapScript, storyIndex: StoryIndex, sourceManifest: SourceManifest, targetDurationSeconds: number | undefined): RecapScript {
  const beatIds = new Set(storyIndex.beats.map((beat) => beat.id))
  const expectedDuration = clamp(targetDurationSeconds ?? defaultRecapTargetDuration(sourceManifest.duration), 0, sourceManifest.duration)

  if (recapScript.segments.length === 0) {
    throw new Error('Film Recap script provider returned no segments.')
  }

  for (const segment of recapScript.segments) {
    if (segment.targetBeatIds.length === 0) {
      throw new Error(`Recap script segment ${segment.id} must reference at least one story-index beat.`)
    }

    for (const beatId of segment.targetBeatIds) {
      if (!beatIds.has(beatId)) {
        throw new Error(`Recap script segment ${segment.id} references unknown story-index beat ${beatId}.`)
      }
    }

    if (segment.suggestedDuration <= 0) {
      throw new Error(`Recap script segment ${segment.id} must have a positive suggestedDuration.`)
    }
  }

  const repeatedText = findRepeatedNarrationText(recapScript.segments)

  if (repeatedText !== undefined) {
    throw new Error(`Recap script narration is too repetitive near "${repeatedText}".`)
  }

  return normalizeRecapScriptDurations(recapScript, expectedDuration)
}

function normalizeRecapScriptDurations(recapScript: RecapScript, targetDuration: number): RecapScript {
  const currentDuration = recapScript.segments.reduce((total, segment) => total + Math.max(0, segment.suggestedDuration), 0)

  if (targetDuration <= 0 || currentDuration <= 0) {
    return {
      ...recapScript,
      totalEstimatedDuration: roundSeconds(currentDuration),
    }
  }

  const scale = targetDuration / currentDuration
  const segments = recapScript.segments.map((segment) => ({
    ...segment,
    suggestedDuration: roundSeconds(segment.suggestedDuration * scale),
  }))
  const durationDelta = roundSeconds(targetDuration - segments.reduce((total, segment) => total + segment.suggestedDuration, 0))
  const lastSegment = segments.at(-1)

  if (lastSegment !== undefined && Math.abs(durationDelta) >= 0.001) {
    lastSegment.suggestedDuration = roundSeconds(Math.max(0.001, lastSegment.suggestedDuration + durationDelta))
  }

  return {
    ...recapScript,
    segments,
    totalEstimatedDuration: roundSeconds(segments.reduce((total, segment) => total + segment.suggestedDuration, 0)),
  }
}

function findRepeatedNarrationText(segments: RecapScriptSegment[]): string | undefined {
  const seen = new Map<string, number>()

  for (const segment of segments) {
    for (const phrase of extractRepeatedPhraseCandidates(segment.narrationText)) {
      const count = (seen.get(phrase) ?? 0) + 1

      if (count >= 3) {
        return phrase
      }

      seen.set(phrase, count)
    }
  }

  return undefined
}

function extractRepeatedPhraseCandidates(text: string): string[] {
  const normalized = text.replace(/\s+/gu, '')
  const candidates = new Set<string>()

  for (let size = 6; size <= 12; size += 2) {
    for (let index = 0; index + size <= normalized.length; index += size) {
      const phrase = normalized.slice(index, index + size)

      if (!isLowValueRepeatedPhrase(phrase)) {
        candidates.add(phrase)
      }
    }
  }

  return [...candidates]
}

function isLowValueRepeatedPhrase(phrase: string): boolean {
  return phrase.length < 6 || /^(这段剧情|这个场景|故事继续|矛盾继续|关键时刻|随后|最后)/u.test(phrase)
}

function createOutputNarration(clipPlan: ClipPlan, outputTimelineMap: OutputTimelineMap, storyIndex: StoryIndex, asrResult: ASRResult | undefined, language: string, recapScript: RecapScript): OutputNarration {
  const beatsById = new Map(storyIndex.beats.map((beat) => [beat.id, beat]))
  const clipsById = new Map(clipPlan.clips.map((clip) => [clip.id, clip]))
  const scriptSegmentsById = new Map(recapScript.segments.map((segment) => [segment.id, segment]))

  return {
    language,
    segments: outputTimelineMap.clips.map((mappedClip, index) => {
      const clip = clipsById.get(mappedClip.clipId)

      if (clip === undefined) {
        throw new Error(`Output timeline references unknown clip ${mappedClip.clipId}.`)
      }

      if (clip.scriptSegmentId === undefined) {
        throw new Error(`Clip ${clip.id} is not script-driven; every Film Recap narration segment must reference recap-script.json.`)
      }

      const beat = clip?.beatId === undefined ? undefined : beatsById.get(clip.beatId)
      const scriptSegment = scriptSegmentsById.get(clip.scriptSegmentId)

      if (scriptSegment === undefined) {
        throw new Error(`Clip ${clip.id} references missing recap script segment ${clip.scriptSegmentId}.`)
      }

      const start = roundSeconds(mappedClip.outputStart)
      const end = roundSeconds(mappedClip.outputEnd)
      const beatRef = beat?.id ?? clip?.sceneId ?? mappedClip.clipId
      const clipSourceRange = [mappedClip.sourceStart, mappedClip.sourceEnd] as [number, number]
      const asrSegments = collectAsrSegmentsForRange(asrResult, clipSourceRange)
      const text = createScriptNarrationText(scriptSegment, index, language)

      return {
        end,
        evidence: [
          beatRef,
          mappedClip.clipId,
          ...(scriptSegment === undefined ? [] : [`recap-script.json#${scriptSegment.id}`]),
          ...asrSegments.map((segment) => `asr-result.json#${segment.id}`),
        ],
        id: `output-narration-${String(index + 1).padStart(3, '0')}`,
        overlapsSpeech: false,
        pauseAfterMs: index === outputTimelineMap.clips.length - 1 ? 0 : 250,
        scriptSegmentId: scriptSegment.id,
        source: 'script' as const,
        start,
        text,
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

function createScriptNarrationText(scriptSegment: RecapScriptSegment, index: number, language: string): string {
  const text = cleanNarrationText(scriptSegment.narrationText, language)

  if (text === '') {
    throw new Error(`Recap script segment ${scriptSegment.id} has no valid ${language} narration text for output segment ${index + 1}.`)
  }

  return text
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
      'libx264',
      '-preset',
      'veryfast',
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
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outputPath,
  ])
}

function createFilmClipPlan(sourceManifest: SourceManifest, storyIndex: StoryIndex, targetDuration: number | undefined, asrResult: ASRResult | undefined, recapScript: RecapScript): ClipPlan {
  const scriptDrivenPlan = createScriptDrivenFilmClipPlan(sourceManifest, storyIndex, recapScript, targetDuration, asrResult)

  if (scriptDrivenPlan.clips.length === 0) {
    throw new Error('Film Recap clip planning produced no script-driven clips.')
  }

  return scriptDrivenPlan
}

function createScriptDrivenFilmClipPlan(sourceManifest: SourceManifest, storyIndex: StoryIndex, recapScript: RecapScript, targetDuration: number | undefined, asrResult?: ASRResult): ClipPlan {
  const beatsById = new Map(storyIndex.beats.map((beat) => [beat.id, beat]))
  const scriptTarget = recapScript.totalEstimatedDuration > 0 ? recapScript.totalEstimatedDuration : defaultRecapTargetDuration(sourceManifest.duration)
  const effectiveTarget = clamp(targetDuration ?? scriptTarget, 0, sourceManifest.duration)
  const scriptDurationTotal = recapScript.segments.reduce((total, segment) => total + Math.max(0, segment.suggestedDuration), 0)
  const durationScale = scriptDurationTotal > 0 && effectiveTarget > 0 ? effectiveTarget / scriptDurationTotal : 1
  const clips: ClipPlanItem[] = []
  let outputCursor = 0

  for (const [segmentIndex, segment] of recapScript.segments.entries()) {
    if (outputCursor >= effectiveTarget - 0.001) {
      break
    }

    const targetBeats = segment.targetBeatIds
      .flatMap((beatId) => {
        const beat = beatsById.get(beatId)

        return beat === undefined ? [] : [beat]
      })

    if (targetBeats.length === 0) {
      throw new Error(`Recap script segment ${segment.id} does not reference any story-index beat.`)
    }

    const scaledSegmentDuration = roundSeconds(Math.max(0, segment.suggestedDuration * durationScale))
    const remainingDuration = roundSeconds(effectiveTarget - outputCursor)
    const segmentDuration = Math.min(remainingDuration, scaledSegmentDuration > 0 ? scaledSegmentDuration : remainingDuration)
    const beatDurations = allocateDurationsBySourceRange(targetBeats, segmentDuration)

    for (const [beatIndex, beat] of targetBeats.entries()) {
      if (outputCursor >= effectiveTarget - 0.001) {
        break
      }

      const requestedDuration = Math.min(beatDurations[beatIndex] ?? 0, effectiveTarget - outputCursor)
      const candidate = createScriptClipCandidate(segment, beat, sourceManifest.duration, requestedDuration, asrResult)

      if (candidate === undefined) {
        throw new Error(`Recap script segment ${segment.id} could not produce a clip for beat ${beat.id}.`)
      }

      if (clips.some((clip) => rangesOverlap(clip.sourceRange, candidate.sourceRange))) {
        throw new Error(`Recap script segment ${segment.id} produced an overlapping clip for beat ${beat.id}.`)
      }

      const duration = roundSeconds(candidate.sourceRange[1] - candidate.sourceRange[0])

      clips.push({
        beatId: beat.id,
        duration,
        id: `clip-${String(clips.length + 1).padStart(3, '0')}`,
        priorityScore: scoreNarrativeBeatForClipPlanning(beat),
        reason: `Selected script segment ${segment.id} for ${beat.type} beat ${beat.id}: ${segment.visualGuidance}`,
        sceneId: beat.id,
        scriptSegmentId: segment.id,
        selectionReason: 'script-driven',
        selectionRank: segmentIndex + 1,
        source: sourceManifest.sourcePath,
        sourceRange: candidate.sourceRange,
        start: roundSeconds(outputCursor),
      })
      outputCursor = roundSeconds(outputCursor + duration)
    }
  }

  return {
    clips,
    duration: roundSeconds(outputCursor),
    source: sourceManifest.sourcePath,
    sourceDuration: sourceManifest.duration,
    version: 1,
  }
}

function createScriptClipCandidate(
  segment: RecapScriptSegment,
  beat: NarrativeBeat,
  sourceDuration: number,
  requestedDuration: number,
  asrResult: ASRResult | undefined,
): {sourceRange: [number, number]} | undefined {
  const beatRange = normalizeSourceRange(beat.sourceRange, sourceDuration)
  const beatDuration = roundSeconds(beatRange[1] - beatRange[0])
  const duration = roundSeconds(Math.min(beatDuration, Math.max(0, requestedDuration)))

  if (duration <= 0) {
    return undefined
  }

  if (duration >= beatDuration - 0.001) {
    return {sourceRange: beatRange}
  }

  const asrCandidate = chooseScriptAsrCandidate(segment, beat, beatRange, duration, asrResult)

  if (asrCandidate !== undefined) {
    return asrCandidate
  }

  const sourceStart = chooseBeatFallbackStart(beat, beatRange, duration)
  const sourceEnd = roundSeconds(Math.min(beatRange[1], sourceStart + duration))

  return sourceEnd <= sourceStart ? undefined : {sourceRange: [sourceStart, sourceEnd]}
}

function chooseScriptAsrCandidate(segment: RecapScriptSegment, beat: NarrativeBeat, beatRange: [number, number], duration: number, asrResult: ASRResult | undefined): {sourceRange: [number, number]} | undefined {
  const candidates = collectAsrSegmentsForRange(asrResult, beatRange)
    .map((asrSegment) => {
      const sourceRange = normalizeSourceRange([asrSegment.start, asrSegment.end], beatRange[1])
      const candidateDuration = roundSeconds(sourceRange[1] - sourceRange[0])

      if (candidateDuration <= 0) {
        return undefined
      }

      return {
        keywordScore: scoreScriptAsrCandidate(segment, beat, asrSegment.text),
        sourceRange: expandSourceRangeAroundEvidence(sourceRange, beatRange, duration),
      }
    })
    .filter((candidate): candidate is {keywordScore: number; sourceRange: [number, number]} => candidate !== undefined)
    .filter((candidate) => candidate.keywordScore > 0)
    .sort((left, right) => right.keywordScore - left.keywordScore || (right.sourceRange[1] - right.sourceRange[0]) - (left.sourceRange[1] - left.sourceRange[0]) || left.sourceRange[0] - right.sourceRange[0])

  return candidates[0] === undefined ? undefined : {sourceRange: candidates[0].sourceRange}
}

function scoreScriptAsrCandidate(segment: RecapScriptSegment, beat: NarrativeBeat, text: string): number {
  const guidance = `${segment.narrationText} ${segment.visualGuidance} ${beat.summary} ${beat.characters.join(' ')}`
  const keywords = ['证据', '录音', '数据', '系统', '真相', '反击', '对峙', '裁员', '绩效', 'VP', 'evidence', 'truth', 'data', 'showdown']
  const scriptedKeywords = extractClipPlanningKeywords(guidance)

  return [
    ...keywords.filter((keyword) => guidance.includes(keyword)),
    ...scriptedKeywords,
  ].reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0)
}

function extractClipPlanningKeywords(text: string): string[] {
  const chineseTerms = Array.from(text.matchAll(/[\p{Script=Han}A-Za-z]{2,8}/gu), (match) => match[0])
  const expandedTerms = [
    ...chineseTerms,
    ...chineseTerms.flatMap((term) => createTermNgrams(term, 2, 4)),
  ]

  return uniqueStrings(expandedTerms)
    .filter((term) => !CLIP_PLANNING_STOPWORDS.has(term))
    .slice(0, 40)
}

function createTermNgrams(term: string, minSize: number, maxSize: number): string[] {
  const output: string[] = []

  for (let size = minSize; size <= Math.min(maxSize, term.length); size += 1) {
    for (let index = 0; index + size <= term.length; index += 1) {
      output.push(term.slice(index, index + size))
    }
  }

  return output
}

const CLIP_PLANNING_STOPWORDS = new Set([
  '这段',
  '剧情',
  '这场',
  '故事',
  '继续',
  '关键',
  '问题',
  '真正',
  '开始',
  '最后',
  '系统',
])

function expandSourceRangeAroundEvidence(evidenceRange: [number, number], beatRange: [number, number], duration: number): [number, number] {
  const beatDuration = roundSeconds(beatRange[1] - beatRange[0])

  if (duration >= beatDuration - 0.001) {
    return beatRange
  }

  const evidenceCenter = (evidenceRange[0] + evidenceRange[1]) / 2
  const rawStart = evidenceCenter - duration / 2
  const start = roundSeconds(clamp(rawStart, beatRange[0], beatRange[1] - duration))

  return [start, roundSeconds(start + duration)]
}

function chooseBeatFallbackStart(beat: NarrativeBeat, beatRange: [number, number], duration: number): number {
  const maxStart = beatRange[1] - duration

  if (maxStart <= beatRange[0]) {
    return beatRange[0]
  }

  const anchor = beat.type === 'climax' || beat.type === 'reversal'
    ? 0.62
    : beat.type === 'resolution'
      ? 0.48
      : beat.type === 'decision' || beat.type === 'inciting_incident'
        ? 0.28
        : 0.42
  const beatDuration = beatRange[1] - beatRange[0]
  const centeredStart = beatRange[0] + beatDuration * anchor - duration / 2

  return roundSeconds(clamp(centeredStart, beatRange[0], maxStart))
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

function normalizeSourceRange(range: [number, number], sourceDuration: number): [number, number] {
  const start = clamp(range[0], 0, sourceDuration)
  const end = clamp(range[1], start, sourceDuration)

  return [start, end]
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

function createBeatSummary(fusionSummary: string, asrTexts: string[], vlmSummaries: string[]): string {
  const asrText = asrTexts.map((item) => item.trim()).filter(Boolean).join(' ')
  const vlmText = vlmSummaries.map((item) => item.trim()).filter(Boolean).join(' ')
  const text = asrText === '' ? vlmText === '' ? fusionSummary.trim() : vlmText : asrText

  if (text === '') {
    throw new Error('Narrative beat summary requires ASR, VLM, or timeline fusion text.')
  }

  return trimToSentenceBoundary(text, 260)
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
    ...extractChineseNamedCharacters(text),
    ...knownRoles.filter((role) => text.includes(role)),
    ...englishRoles.flatMap(([keyword, label]) => text.toLowerCase().includes(keyword) ? [label] : []),
  ])
}

function extractChineseNamedCharacters(text: string): string[] {
  const titledNames = Array.from(text.matchAll(/[\p{Script=Han}A-Za-z]{1,8}(?:总|经理|主任|主管|VP|CEO|CFO|CTO)/giu), (match) => match[0])
  const actionSubjects = Array.from(text.matchAll(/(?<![\p{Script=Han}])([\p{Script=Han}]{2,3})(?=回到|回归|回来|宣布|拿出|指出|发现|决定|要求|质问|追问|证明|对比|离开|留下|接住|求助|改革|承诺|反击)/gu), (match) => match[1] ?? '')
  const objectNames = Array.from(text.matchAll(/([\p{Script=Han}]{1,6}总)(?=被裁|被开除|被问责|被调查)/gu), (match) => match[1] ?? '')

  return [...titledNames, ...actionSubjects, ...objectNames]
    .map((name) => name.trim())
    .filter((name) => name !== '' && !CHINESE_CHARACTER_STOPWORDS.has(name))
}

const CHINESE_CHARACTER_STOPWORDS = new Set([
  '公司',
  '部分',
  '资深',
  '同事',
  '老员工',
  '系统',
  '记录',
  '数据',
  '故事',
  '剧情',
  '问题',
  '真相',
  '管理层',
])

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
    throw new Error('Film Recap production scene planning requires timed ASR segments.')
  }

  const groupCount = normalizeFilmSceneGroupCount(maxScenes, timedSegments.length)
  const scenes = Array.from({length: groupCount}, (_, index) => {
    const startIndex = Math.floor(index * timedSegments.length / groupCount)
    const endIndex = Math.floor((index + 1) * timedSegments.length / groupCount)
    const group = timedSegments.slice(startIndex, endIndex)
    const start = roundSeconds(clamp(group[0]?.start ?? 0, 0, sourceManifest.duration))
    const end = roundSeconds(clamp(group.at(-1)?.end ?? start, start, sourceManifest.duration))
    const summary = group.map((segment) => segment.text).join(' ').slice(0, 180)

    if (summary.trim() === '') {
      throw new Error(`ASR-backed film scene ${index + 1} has no transcript text.`)
    }

    return {
      id: `scene-${String(index + 1).padStart(3, '0')}`,
      sourceRange: [start, end] as [number, number],
      summary,
    }
  }).filter((scene) => scene.sourceRange[1] > scene.sourceRange[0])

  if (scenes.length === 0) {
    throw new Error('Film Recap production scene planning produced no ASR-backed scenes.')
  }

  return {
    scenes,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function normalizeFilmSceneGroupCount(maxScenes: number, segmentCount: number): number {
  const requested = Number.isFinite(maxScenes) ? Math.floor(maxScenes) : segmentCount

  return Math.max(1, Math.min(requested, segmentCount))
}

function createFilmSilencePeriods(sourceManifest: SourceManifest, asrResult: ASRResult): SilencePeriods {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
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

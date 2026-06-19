import {assertPipelineCheckpointArtifacts, assertPipelineStage} from '@video-agent/runtime'
import {
  createFilmClipPlanProject,
  createFilmIngestProject,
  createFilmRecapScriptProject,
  createFilmStoryIndexProject,
  createFilmUnderstandingProject,
  type CreateFilmClipPlanProjectOptions,
  type CreateFilmClipPlanProjectResult,
  type CreateFilmIngestProjectOptions,
  type CreateFilmIngestProjectResult,
  type CreateFilmRecapScriptProjectResult,
  type CreateFilmStoryIndexProjectResult,
  type CreateFilmUnderstandingProjectOptions,
  type CreateFilmUnderstandingProjectResult,
} from './film-project.js'
import {
  createFilmAudioMixProject,
  createFilmCutProject,
  createFilmFinalRenderProject,
  createFilmOutputNarrationProject,
  createFilmQualityCheckProject,
  createFilmSubtitleProject,
  createFilmVoiceoverProject,
  type CreateFilmAudioMixProjectResult,
  type CreateFilmCutProjectResult,
  type CreateFilmFinalRenderProjectResult,
  type CreateFilmOutputNarrationProjectResult,
  type CreateFilmQualityCheckProjectResult,
  type CreateFilmSubtitleProjectResult,
  type CreateFilmVoiceoverProjectResult,
} from './film-output-stages.js'
import {FILM_PIPELINE_DEFINITION, FILM_PIPELINE_STAGES, type FilmPipelineStage} from './pipeline.js'

const FILM_STAGES = FILM_PIPELINE_STAGES

export interface RunFilmRecapProjectOptions extends CreateFilmIngestProjectOptions {
  fromStage?: FilmPipelineStage
  llmClient?: CreateFilmUnderstandingProjectOptions['llmClient']
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
    llmClient: options.llmClient,
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

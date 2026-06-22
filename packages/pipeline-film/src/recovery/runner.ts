import {PIPELINE_EVENT_STAGE_RETRY, PIPELINE_KIND_FILM, assertPipelineStage, runPipeline, type Stage} from '@video-agent/core'
import {appendProjectEvent, assertPipelineCheckpointArtifacts, createProjectId, createProjectWorkspace, readConfig, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
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
} from '../project/index.js'
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
} from '../output/index.js'
import {FILM_PIPELINE_DEFINITION, FILM_PIPELINE_STAGES, FILM_STAGE_IDS, type FilmPipelineStage} from '../pipeline.js'

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
  outputNarration?: CreateFilmOutputNarrationProjectResult
  pipeline: typeof PIPELINE_KIND_FILM
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
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const fromStage = options.fromStage ?? FILM_PIPELINE_DEFINITION.defaultRerunStage
  assertPipelineStage(FILM_PIPELINE_DEFINITION, fromStage)

  if (fromStage !== FILM_STAGE_IDS.ingest && options.projectId === undefined) {
    throw new Error('projectId is required when running a Film Recap project from a checkpoint stage.')
  }

  const projectId = options.projectId ?? createProjectId(options.inputPath)

  if (fromStage !== FILM_STAGE_IDS.ingest) {
    await assertPipelineCheckpointArtifacts(projectId, workspaceDir, FILM_PIPELINE_DEFINITION, fromStage)
  }

  const config = await readConfig(workspaceDir)
  const common = {
    llmClient: options.llmClient,
    projectId,
    trace: options.trace,
    workspaceDir: options.workspaceDir,
  }
  const result: RunFilmRecapProjectResult = {
    completedStages: [],
    fromStage,
    pipeline: PIPELINE_KIND_FILM,
    projectDir: '',
    projectId,
    status: 'completed',
  }
  const assignStageOutput = <T>(stage: FilmPipelineStage, output: T): T => {
    const stageProject = output as {projectDir?: string; projectId?: string}

    if (stageProject.projectId !== projectId) {
      throw new Error(`Film stage ${stage} returned projectId ${JSON.stringify(stageProject.projectId)} but runner expected ${JSON.stringify(projectId)}; no projectId reconciliation fallback is allowed.`)
    }

    if (stageProject.projectDir === undefined || stageProject.projectDir === '') {
      throw new Error(`Film stage ${stage} did not return projectDir; no runner projectDir fallback is allowed.`)
    }

    result.completedStages.push(stage)
    result.projectDir = stageProject.projectDir

    return output
  }
  const stageCommon = () => ({
    ...common,
    projectId,
  })
  const stages: Array<Stage<RunFilmRecapProjectResult, RunFilmRecapProjectResult>> = [
    {
      name: FILM_STAGE_IDS.ingest,
      async run() {
        result.ingest = assignStageOutput(FILM_STAGE_IDS.ingest, await createFilmIngestProject({
          inputPath: options.inputPath,
          projectId,
          trace: options.trace,
          workspaceDir: options.workspaceDir,
        }))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.understandSource,
      async run() {
        result.understanding = assignStageOutput(FILM_STAGE_IDS.understandSource, await createFilmUnderstandingProject({
          ...stageCommon(),
          maxScenes: options.maxScenes,
        }))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.buildStoryIndex,
      async run() {
        result.storyIndex = assignStageOutput(FILM_STAGE_IDS.buildStoryIndex, await createFilmStoryIndexProject(stageCommon()))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.writeScript,
      async run() {
        result.script = assignStageOutput(FILM_STAGE_IDS.writeScript, await createFilmRecapScriptProject({
          ...stageCommon(),
          targetDurationSeconds: options.targetDurationSeconds,
        }))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.planClips,
      async run() {
        result.clipPlan = assignStageOutput(FILM_STAGE_IDS.planClips, await createFilmClipPlanProject({
          ...stageCommon(),
          targetDurationSeconds: options.targetDurationSeconds,
        }))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.renderCut,
      async run() {
        result.cut = assignStageOutput(FILM_STAGE_IDS.renderCut, await createFilmCutProject(stageCommon()))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.narrateOutput,
      async run() {
        result.outputNarration = assignStageOutput(FILM_STAGE_IDS.narrateOutput, await createFilmOutputNarrationProject(stageCommon()))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.synthesizeVoice,
      async run() {
        result.voiceover = assignStageOutput(FILM_STAGE_IDS.synthesizeVoice, await createFilmVoiceoverProject(stageCommon()))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.mixAudio,
      async run() {
        result.audioMix = assignStageOutput(FILM_STAGE_IDS.mixAudio, await createFilmAudioMixProject(stageCommon()))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.subtitle,
      async run() {
        result.subtitle = assignStageOutput(FILM_STAGE_IDS.subtitle, await createFilmSubtitleProject(stageCommon()))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.renderFinal,
      async run() {
        result.finalRender = assignStageOutput(FILM_STAGE_IDS.renderFinal, await createFilmFinalRenderProject(stageCommon()))

        return result
      },
    },
    {
      name: FILM_STAGE_IDS.qualityCheck,
      async run() {
        result.quality = assignStageOutput(FILM_STAGE_IDS.qualityCheck, await createFilmQualityCheckProject(stageCommon()))

        return result
      },
    },
  ]
  const firstStageIndex = FILM_STAGES.indexOf(fromStage)

  await runPipeline<RunFilmRecapProjectResult, RunFilmRecapProjectResult>(result, stages.slice(firstStageIndex), {
    artifactsDir: '',
    async emit(event) {
      if (event.type !== PIPELINE_EVENT_STAGE_RETRY) {
        return
      }

      const workspace = await createProjectWorkspace({
        projectId,
        workspaceDir,
      })

      await appendProjectEvent(workspace, {
        ...event,
        projectId,
      })
    },
    projectId,
    retryPolicy: {
      backoffMs: config.pipeline.retryBackoffMs,
      maxRetries: config.pipeline.maxStageRetries,
    },
    workspaceDir,
  })
  if (result.quality === undefined) {
    throw new Error('Film Recap runner finished without quality-check output; no completed-status fallback is allowed.')
  }

  result.status = result.quality.qualityReport.summary.errors === 0 ? 'completed' : 'failed'

  return result
}

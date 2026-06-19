import {resolve} from 'node:path'

import {runFilmRecapProject, type RunFilmRecapProjectResult} from './film-rerun-runner.js'
import {FILM_PIPELINE_DEFINITION, type FilmPipelineStage} from './pipeline.js'
import {assertPipelineStage, createConfiguredJobStore, detectPipelineKind, readConfig, type PipelineStage} from '@video-agent/runtime'

export interface RerunProjectOptions {
  fromStage?: PipelineStage
  workspaceDir?: string
}

export type RerunProjectResult = RunFilmRecapProjectResult

export async function rerunProject(projectId: string, options: RerunProjectOptions = {}): Promise<RerunProjectResult> {
  const workspaceDir = resolve(options.workspaceDir ?? '.video-agent')
  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const config = await readConfig(workspaceDir)
  const job = await createConfiguredJobStore({
    config,
    projectDir,
    projectId,
    workspaceDir,
  }).read()
  const pipelineKind = detectPipelineKind(job)

  if (pipelineKind === 'film') {
    const fromStage = assertPipelineStage(FILM_PIPELINE_DEFINITION, options.fromStage ?? FILM_PIPELINE_DEFINITION.defaultRerunStage)

    return runFilmRecapProject({
      fromStage: fromStage as FilmPipelineStage,
      inputPath: job.inputPath,
      projectId,
      workspaceDir,
    })
  }

  throw new Error(`Rerun is not implemented for ${pipelineKind} projects. Use the dedicated deck commands for deck stage recovery.`)
}

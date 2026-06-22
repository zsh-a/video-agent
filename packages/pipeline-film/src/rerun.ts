import {resolve} from 'node:path'

import {runFilmRecapProject, type RunFilmRecapProjectResult} from './recovery/runner.js'
import {FILM_PIPELINE_DEFINITION, type FilmPipelineStage} from './pipeline.js'
import {PIPELINE_KIND_FILM, assertPipelineStage, detectPipelineKind} from '@video-agent/core'
import {createConfiguredJobStore, readConfig, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'

export interface RerunFilmProjectOptions {
  fromStage?: FilmPipelineStage
  workspaceDir?: string
}

export type RerunFilmProjectResult = RunFilmRecapProjectResult

export async function rerunFilmProject(projectId: string, options: RerunFilmProjectOptions = {}): Promise<RerunFilmProjectResult> {
  const workspaceDir = resolve(options.workspaceDir ?? DEFAULT_WORKSPACE_DIR)
  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const config = await readConfig(workspaceDir)
  const job = await createConfiguredJobStore({
    config,
    projectDir,
    projectId,
    workspaceDir,
  }).read()
  const pipelineKind = detectPipelineKind(job)

  if (pipelineKind !== PIPELINE_KIND_FILM) {
    throw new Error(`Film rerun requires a film project; job-state.json declares ${pipelineKind}.`)
  }

  const fromStage = assertPipelineStage(FILM_PIPELINE_DEFINITION, options.fromStage ?? FILM_PIPELINE_DEFINITION.defaultRerunStage)

  return runFilmRecapProject({
    fromStage,
    inputPath: job.inputPath,
    projectId,
    workspaceDir,
  })
}

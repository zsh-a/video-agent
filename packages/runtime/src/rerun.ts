import {resolve} from 'node:path'

import {readConfig} from './config.js'
import {runFilmRecapProject, type RunFilmRecapProjectResult} from './film-project.js'
import {type InitialPipelineStage, runInitialPipeline, type RunInitialPipelineResult} from './job-runner.js'
import {createConfiguredJobStore} from './job-store.js'
import {assertPipelineStage, detectPipelineKind, getPipelineDefinition, type FilmPipelineStage, type PipelineStage} from './pipeline-definitions.js'

export interface RerunProjectOptions {
  fromStage?: PipelineStage
  workspaceDir?: string
}

export type RerunProjectResult = RunFilmRecapProjectResult | RunInitialPipelineResult

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
  const definition = getPipelineDefinition(pipelineKind)
  const fromStage = assertPipelineStage(definition, options.fromStage ?? definition.defaultRerunStage)

  if (pipelineKind === 'film') {
    return runFilmRecapProject({
      fromStage: fromStage as FilmPipelineStage,
      inputPath: job.inputPath,
      projectId,
      workspaceDir,
    })
  }

  return runInitialPipeline({
    fromStage: fromStage as InitialPipelineStage,
    inputPath: job.inputPath,
    projectId,
    workspaceDir,
  })
}

import {resolve} from 'node:path'

import {readConfig} from './config.js'
import {type InitialPipelineStage, runInitialPipeline, type RunInitialPipelineResult} from './job-runner.js'
import {createConfiguredJobStore} from './job-store.js'

export interface RerunProjectOptions {
  fromStage?: InitialPipelineStage
  workspaceDir?: string
}

export async function rerunProject(projectId: string, options: RerunProjectOptions = {}): Promise<RunInitialPipelineResult> {
  const workspaceDir = resolve(options.workspaceDir ?? '.video-agent')
  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const config = await readConfig(workspaceDir)
  const job = await createConfiguredJobStore({
    config,
    projectDir,
    projectId,
    workspaceDir,
  }).read()

  return runInitialPipeline({
    fromStage: options.fromStage ?? 'plan',
    inputPath: job.inputPath,
    projectId,
    workspaceDir,
  })
}

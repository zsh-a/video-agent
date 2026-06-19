import type {RunTuiActionOptions, TuiActionResult} from './tui-action-types.js'

import {recoverWorkspaceJobs, rerunProject} from '@video-agent/pipeline-film'
import {exportProject, ExportQualityError, PipelineCheckpointError, renderProject} from '@video-agent/runtime'

import {createExportQualityFailurePayload} from '../commands/export.js'
import {createCheckpointErrorPayload} from '../utils/checkpoint-errors.js'
import {readMostRecentProjectId, resolveRecoverableStatuses} from './tui-action-resolvers.js'

export async function runTuiOperateAction(options: RunTuiActionOptions): Promise<TuiActionResult> {
  if (options.action === 'rerun') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))
    let result: Awaited<ReturnType<typeof rerunProject>>

    try {
      result = await rerunProject(projectId, {
        fromStage: options.fromStage,
        workspaceDir: options.workspaceDir,
      })
    } catch (error) {
      if (error instanceof PipelineCheckpointError) {
        return {
          action: 'rerun',
          error: createCheckpointErrorPayload(error).error,
          projectId,
          type: 'checkpoint-error',
        }
      }

      throw error
    }

    return {
      fromStage: options.fromStage,
      projectId: result.projectId,
      status: result.status,
      type: 'rerun',
    }
  }

  if (options.action === 'render') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      result: await renderProject(projectId, {
        audio: options.renderAudio,
        audioDucking: options.renderAudioDucking,
        duckingAttackMs: options.renderDuckingAttackMs,
        duckingRatio: options.renderDuckingRatio,
        duckingReleaseMs: options.renderDuckingReleaseMs,
        duckingThreshold: options.renderDuckingThreshold,
        output: options.renderOutputPath,
        sourceVolume: options.renderSourceVolume,
        subtitles: options.renderSubtitles,
        voiceoverVolume: options.renderVoiceoverVolume,
        workspaceDir: options.workspaceDir,
      }),
      type: 'render',
    }
  }

  if (options.action === 'export') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    try {
      return {
        result: await exportProject({
          cleanOutput: options.exportCleanOutput,
          format: options.exportFormat,
          outputPath: options.exportOutputPath,
          projectId,
          requireQuality: options.exportRequireQuality,
          workspaceDir: options.workspaceDir,
        }),
        type: 'export',
      }
    } catch (error) {
      if (error instanceof ExportQualityError) {
        return {
          action: 'export',
          error: createExportQualityFailurePayload(error.projectId, error.quality, error.message).error,
          projectId,
          quality: error.quality,
          type: 'export-quality-error',
        }
      }

      throw error
    }
  }

  const result = await recoverWorkspaceJobs({
    dryRun: options.dryRun,
    limit: options.limit,
    maxAttempts: options.maxAttempts,
    orderBy: options.orderBy,
    runningStaleAfterMs: options.runningStaleAfterMs,
    statuses: resolveRecoverableStatuses(options.status),
    workspaceDir: options.workspaceDir,
  })

  return {
    dryRun: result.dryRun,
    recovered: result.recovered,
    results: result.results,
    skipped: result.skipped,
    type: 'worker',
  }
}

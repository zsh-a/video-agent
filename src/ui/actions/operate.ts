import type {ExportFormat} from '@video-agent/runtime'
import type {RunTuiActionOptions, TuiActionResult} from './types.js'

import {recoverFilmWorkspaceJobs, rerunFilmProject, resolveFilmRecoverableStatuses} from '@video-agent/pipeline-film'
import {exportProject, ExportQualityError, isExportFormat, PipelineCheckpointError, readMostRecentProjectId, renderProject} from '@video-agent/runtime'

import {createCheckpointErrorPayload} from '../../utils/checkpoint-errors.js'
import {createExportQualityFailurePayload} from '../../utils/export-output.js'
import {isTuiOperateAction} from '../model.js'

export async function runTuiOperateAction(options: RunTuiActionOptions): Promise<TuiActionResult> {
  if (!isTuiOperateAction(options.action)) {
    throw new Error(`Unsupported TUI action "${options.action}".`)
  }

  if (options.action === 'rerun') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))
    let result: Awaited<ReturnType<typeof rerunFilmProject>>

    try {
      result = await rerunFilmProject(projectId, {
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
    const format = requireExportFormat(options.exportFormat)

    try {
      return {
        result: await exportProject({
          cleanOutput: options.exportCleanOutput,
          format,
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

  if (options.action === 'worker') {
    const result = await recoverFilmWorkspaceJobs({
      dryRun: options.dryRun,
      limit: options.limit,
      maxAttempts: options.maxAttempts,
      orderBy: options.orderBy,
      runningStaleAfterMs: options.runningStaleAfterMs,
      statuses: resolveFilmRecoverableStatuses(options.status),
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

  throw new Error(`Unsupported TUI operation "${options.action}".`)
}

function requireExportFormat(format: ExportFormat | undefined): ExportFormat {
  if (format !== undefined && isExportFormat(format)) {
    return format
  }

  throw new Error('TUI export action requires --export-format; no render-output format inference is allowed.')
}

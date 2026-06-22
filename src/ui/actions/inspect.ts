import type {RunTuiActionOptions, TuiActionResult} from './types.js'

import {inspectFfmpegAudio, listProjects, readMostRecentProjectId, readProjectArtifact, readProjectEvents, readProjectQuality, readProjectQualityDetails, readProjectStatus, readProjectVisualSamples, resolveProviderSmokeTestRoles, runProviderSmokeTest, verifyProjectArtifacts} from '@video-agent/runtime'

import {isTuiInspectAction} from '../model.js'

export async function runTuiInspectAction(options: RunTuiActionOptions): Promise<TuiActionResult | undefined> {
  if (!isTuiInspectAction(options.action)) {
    return undefined
  }

  if (options.action === 'artifact') {
    if (options.artifactName === undefined) {
      throw new Error('Pass --artifact <name> when using --action artifact.')
    }

    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))
    const result = await readProjectArtifact(projectId, options.artifactName, options.workspaceDir)

    return {
      artifact: result.artifact,
      content: result.content,
      projectId,
      type: 'artifact',
    }
  }

  if (options.action === 'provider-test') {
    return {
      report: await runProviderSmokeTest({
        framePath: options.framePath,
        mediaPath: options.mediaPath,
        roles: resolveProviderSmokeTestRoles(options.providerRole),
        text: options.text,
        workspaceDir: options.workspaceDir,
      }),
      type: 'provider-test',
    }
  }

  if (options.action === 'projects') {
    return {
      projects: await listProjects(options.workspaceDir),
      type: 'projects',
    }
  }

  if (options.action === 'quality') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      report: options.qualityDetails === true ? await readProjectQualityDetails(projectId, options.workspaceDir) : await readProjectQuality(projectId, options.workspaceDir),
      type: 'quality',
    }
  }

  if (options.action === 'events') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      result: await readProjectEvents(projectId, {
        kind: options.eventKind,
        limit: options.eventLimit,
        pipelineStage: options.eventPipelineStage,
        pipelineType: options.eventPipelineType,
        providerRole: options.eventProviderRole,
        providerStatus: options.eventProviderStatus,
        workspaceDir: options.workspaceDir,
      }),
      type: 'events',
    }
  }

  if (options.action === 'status') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      status: await readProjectStatus(projectId, options.workspaceDir),
      type: 'status',
    }
  }

  if (options.action === 'verify') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      projectId,
      result: await verifyProjectArtifacts(projectId, options.workspaceDir),
      type: 'verify',
    }
  }

  if (options.action === 'audio') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      diagnostics: await inspectFfmpegAudio(projectId, {
        audio: options.renderAudio,
        audioDucking: options.renderAudioDucking,
        duckingAttackMs: options.renderDuckingAttackMs,
        duckingRatio: options.renderDuckingRatio,
        duckingReleaseMs: options.renderDuckingReleaseMs,
        duckingThreshold: options.renderDuckingThreshold,
        sourceVolume: options.renderSourceVolume,
        voiceoverVolume: options.renderVoiceoverVolume,
        workspaceDir: options.workspaceDir,
      }),
      projectId,
      type: 'audio',
    }
  }

  if (options.action === 'visual') {
    const projectId = options.projectId ?? (await readMostRecentProjectId(options.workspaceDir))

    return {
      report: await readProjectVisualSamples(projectId, {
        includeContent: options.visualIncludeContent,
        workspaceDir: options.workspaceDir,
      }),
      type: 'visual',
    }
  }

  return undefined
}

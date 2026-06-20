import type {PipelineStage} from '@video-agent/runtime'
import type {McpToolDefinition} from './toolkit.js'

import {FILM_PIPELINE_STAGES, recoverWorkspaceJobs, rerunProject} from '@video-agent/pipeline-film'
import {
  listProjectArtifacts,
  listProjects,
  readProjectArtifact,
  readProjectEvents,
  readProjectProviderReport,
  readProjectQuality,
  readProjectQualityDetails,
  readProjectStatus,
  readProjectVisualSamples,
  readVideoAgentGuidedActions,
  verifyProjectArtifacts,
} from '@video-agent/runtime'
import {
  booleanSchema,
  createToolDefinition,
  enumSchema,
  integerSchema,
  projectIdSchema,
  readOptionalBoolean,
  readOptionalEnum,
  readOptionalInteger,
  readOptionalString,
  readRequiredString,
  stringSchema,
} from './toolkit.js'

const RERUN_STAGE_VALUES: PipelineStage[] = [...FILM_PIPELINE_STAGES]
const PIPELINE_EVENT_TYPES = ['agent:run:complete', 'agent:run:fail', 'agent:run:start', 'agent:step:complete', 'agent:step:fail', 'agent:step:progress', 'agent:step:start', 'artifact', 'log', 'stage:complete', 'stage:fail', 'stage:progress', 'stage:retry', 'stage:start', 'tool:call:complete', 'tool:call:fail', 'tool:call:start'] as const

export const PROJECT_MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  createToolDefinition('video_agent_list_projects', 'List projects in the video-agent workspace.', {}, async (_args, workspaceDir) => ({projects: await listProjects(workspaceDir)})),
  createToolDefinition('video_agent_guided_actions', 'Read reusable guided action metadata for a workspace or focused project.', {
    artifactLimit: integerSchema('Maximum number of project artifacts to include in generated artifact preview actions. Defaults to 5.'),
    commandPrefix: stringSchema('Command prefix for generated copyable commands, for example "vagent" or "bun run dev". Defaults to vagent.'),
    projectId: stringSchema('Optional project id to focus. Defaults to the most recently updated project when one exists.'),
  }, (args, workspaceDir) => readVideoAgentGuidedActions({
    artifactLimit: readOptionalInteger(args, 'artifactLimit'),
    commandPrefix: readOptionalString(args, 'commandPrefix'),
    projectId: readOptionalString(args, 'projectId'),
    workspaceDir,
  })),
  createToolDefinition('video_agent_status', 'Read job state, artifact list, provider summary, and quality summary for a project.', {
    projectId: projectIdSchema(),
  }, (args, workspaceDir) => readProjectStatus(readRequiredString(args, 'projectId'), workspaceDir)),
  createToolDefinition('video_agent_quality', 'Read project quality, render diagnostics, and artifact integrity summary.', {
    details: booleanSchema('When true, include raw quality-report.json and render-output.json content when present.'),
    projectId: projectIdSchema(),
  }, (args, workspaceDir) => {
    const projectId = readRequiredString(args, 'projectId')

    return readOptionalBoolean(args, 'details') === true ? readProjectQualityDetails(projectId, workspaceDir) : readProjectQuality(projectId, workspaceDir)
  }),
  createToolDefinition('video_agent_visual_samples', 'Read rendered visual frame sample metadata, optionally including base64 image content.', {
    includeContent: booleanSchema('When true, include base64 JPEG content for each available frame sample. Defaults to metadata only.'),
    projectId: projectIdSchema(),
  }, (args, workspaceDir) => readProjectVisualSamples(readRequiredString(args, 'projectId'), {
    includeContent: readOptionalBoolean(args, 'includeContent'),
    workspaceDir,
  })),
  createToolDefinition('video_agent_events', 'Read pipeline and provider events for a project.', {
    kind: enumSchema(['pipeline', 'provider'], 'Optional event stream filter.'),
    limit: integerSchema('Maximum number of events to return.'),
    projectId: projectIdSchema(),
    role: enumSchema(['asr', 'script', 'tts', 'vlm'], 'Provider role filter for provider events.'),
    stage: stringSchema('Pipeline stage filter for pipeline events, for example ingest, understand, render, or quality.'),
    status: enumSchema(['failed', 'succeeded'], 'Provider call status filter for provider events.'),
    type: enumSchema([...PIPELINE_EVENT_TYPES], 'Pipeline event type filter.'),
  }, (args, workspaceDir) => readProjectEvents(readRequiredString(args, 'projectId'), {
    kind: readOptionalEnum(args, 'kind', ['pipeline', 'provider']),
    limit: readOptionalInteger(args, 'limit'),
    pipelineStage: readOptionalString(args, 'stage'),
    pipelineType: readOptionalEnum(args, 'type', [...PIPELINE_EVENT_TYPES]),
    providerRole: readOptionalEnum(args, 'role', ['asr', 'script', 'tts', 'vlm']),
    providerStatus: readOptionalEnum(args, 'status', ['failed', 'succeeded']),
    workspaceDir,
  })),
  createToolDefinition('video_agent_provider_report', 'Summarize provider calls and LLM traces, including usage, cost, and latency for a project.', {
    projectId: projectIdSchema(),
    role: enumSchema(['asr', 'script', 'tts', 'vlm'], 'Optional provider role filter.'),
    status: enumSchema(['failed', 'succeeded'], 'Optional provider call status filter.'),
  }, (args, workspaceDir) => readProjectProviderReport(readRequiredString(args, 'projectId'), {
    role: readOptionalEnum(args, 'role', ['asr', 'script', 'tts', 'vlm']),
    status: readOptionalEnum(args, 'status', ['failed', 'succeeded']),
    workspaceDir,
  })),
  createToolDefinition('video_agent_artifacts', 'List project artifacts or read one artifact by name.', {
    artifactName: stringSchema('Optional artifact filename, such as media-info.json or quality-report.json.'),
    projectId: projectIdSchema(),
  }, (args, workspaceDir) => {
    const projectId = readRequiredString(args, 'projectId')
    const artifactName = readOptionalString(args, 'artifactName')

    return artifactName === undefined ? listProjectArtifacts(projectId, workspaceDir) : readProjectArtifact(projectId, artifactName, workspaceDir)
  }),
  createToolDefinition('video_agent_verify_artifacts', 'Verify artifact manifest hashes and known IR schemas for a project.', {
    projectId: projectIdSchema(),
  }, (args, workspaceDir) => verifyProjectArtifacts(readRequiredString(args, 'projectId'), workspaceDir)),
  createToolDefinition('video_agent_rerun', 'Rerun an existing project from a checkpoint stage.', {
    fromStage: enumSchema(RERUN_STAGE_VALUES, 'Checkpoint stage to resume from. Defaults to the project pipeline default.'),
    projectId: projectIdSchema(),
  }, (args, workspaceDir) => rerunProject(readRequiredString(args, 'projectId'), {
    fromStage: readOptionalEnum(args, 'fromStage', RERUN_STAGE_VALUES),
    workspaceDir,
  })),
  createToolDefinition('video_agent_worker', 'Recover failed or interrupted local pipeline jobs.', {
    dryRun: booleanSchema('When true, list recovery actions without rerunning projects.'),
    limit: integerSchema('Maximum number of recoverable jobs to process this call.'),
    maxAttempts: integerSchema('Skip jobs whose recovery stage attempt is greater than or equal to this value.'),
    orderBy: enumSchema(['attempt', 'oldest', 'recent'], 'Recovery candidate ordering before applying limit.'),
    runningStaleAfterMs: integerSchema('Skip running jobs updated more recently than this threshold.'),
    status: enumSchema(['active', 'failed', 'running'], 'Job status filter. active scans failed and running jobs.'),
  }, (args, workspaceDir) => recoverWorkspaceJobs({
    dryRun: readOptionalBoolean(args, 'dryRun'),
    limit: readOptionalInteger(args, 'limit'),
    maxAttempts: readOptionalInteger(args, 'maxAttempts'),
    orderBy: readOptionalEnum(args, 'orderBy', ['attempt', 'oldest', 'recent']),
    runningStaleAfterMs: readOptionalInteger(args, 'runningStaleAfterMs'),
    statuses: resolveRecoverableStatuses(readOptionalEnum(args, 'status', ['active', 'failed', 'running'])),
    workspaceDir,
  })),
]

function resolveRecoverableStatuses(status: 'active' | 'failed' | 'running' | undefined): Array<'failed' | 'running'> | undefined {
  if (status === undefined || status === 'active') {
    return undefined
  }

  return [status]
}

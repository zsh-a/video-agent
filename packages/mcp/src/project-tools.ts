import type {McpToolDefinition} from './toolkit.js'

import {PIPELINE_EVENT_TYPES} from '@video-agent/core'
import {FILM_PIPELINE_STAGES, FILM_RECOVERY_ORDER_BY_VALUES, FILM_RECOVERY_STATUS_OPTIONS, recoverFilmWorkspaceJobs, rerunFilmProject, resolveFilmRecoverableStatuses} from '@video-agent/pipeline-film'
import {
  listProjectArtifacts,
  listProjects,
  PROJECT_EVENT_KINDS,
  PROVIDER_CALL_ROLES,
  PROVIDER_CALL_STATUSES,
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
  nonNegativeIntegerSchema,
  projectIdSchema,
  readOptionalBoolean,
  readOptionalEnum,
  readOptionalNonNegativeInteger,
  readOptionalString,
  readRequiredString,
  stringSchema,
} from './toolkit.js'

export const PROJECT_MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  createToolDefinition('video_agent_list_projects', 'List projects in the video-agent workspace.', {}, async (_args, workspaceDir) => ({projects: await listProjects(workspaceDir)})),
  createToolDefinition('video_agent_guided_actions', 'Read reusable guided action metadata for a workspace or focused project.', {
    artifactLimit: nonNegativeIntegerSchema('Maximum number of project artifacts to include in generated artifact preview actions. Defaults to 5.'),
    commandPrefix: stringSchema('Command prefix for generated copyable commands, for example "vagent" or "bun run dev". Defaults to vagent.'),
    projectId: stringSchema('Optional project id to focus. Defaults to the most recently updated project when one exists.'),
  }, (args, workspaceDir) => readVideoAgentGuidedActions({
    artifactLimit: readOptionalNonNegativeInteger(args, 'artifactLimit'),
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
    kind: enumSchema([...PROJECT_EVENT_KINDS], 'Optional event stream filter.'),
    limit: nonNegativeIntegerSchema('Maximum number of events to return.'),
    projectId: projectIdSchema(),
    role: enumSchema([...PROVIDER_CALL_ROLES], 'Provider role filter for provider events.'),
    stage: stringSchema('Pipeline stage filter for pipeline events, for example ingest, understand, render, or quality.'),
    status: enumSchema([...PROVIDER_CALL_STATUSES], 'Provider call status filter for provider events.'),
    type: enumSchema([...PIPELINE_EVENT_TYPES], 'Pipeline event type filter.'),
  }, (args, workspaceDir) => readProjectEvents(readRequiredString(args, 'projectId'), {
    kind: readOptionalEnum(args, 'kind', [...PROJECT_EVENT_KINDS]),
    limit: readOptionalNonNegativeInteger(args, 'limit'),
    pipelineStage: readOptionalString(args, 'stage'),
    pipelineType: readOptionalEnum(args, 'type', [...PIPELINE_EVENT_TYPES]),
    providerRole: readOptionalEnum(args, 'role', [...PROVIDER_CALL_ROLES]),
    providerStatus: readOptionalEnum(args, 'status', [...PROVIDER_CALL_STATUSES]),
    workspaceDir,
  })),
  createToolDefinition('video_agent_provider_report', 'Summarize provider calls and LLM traces, including usage, cost, and latency for a project.', {
    projectId: projectIdSchema(),
    role: enumSchema([...PROVIDER_CALL_ROLES], 'Optional provider role filter.'),
    status: enumSchema([...PROVIDER_CALL_STATUSES], 'Optional provider call status filter.'),
  }, (args, workspaceDir) => readProjectProviderReport(readRequiredString(args, 'projectId'), {
    role: readOptionalEnum(args, 'role', [...PROVIDER_CALL_ROLES]),
    status: readOptionalEnum(args, 'status', [...PROVIDER_CALL_STATUSES]),
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
    fromStage: enumSchema(FILM_PIPELINE_STAGES, 'Checkpoint stage to resume from. Defaults to the project pipeline default.'),
    projectId: projectIdSchema(),
  }, (args, workspaceDir) => rerunFilmProject(readRequiredString(args, 'projectId'), {
    fromStage: readOptionalEnum(args, 'fromStage', FILM_PIPELINE_STAGES),
    workspaceDir,
  })),
  createToolDefinition('video_agent_worker', 'Recover failed or interrupted Film pipeline jobs.', {
    dryRun: booleanSchema('When true, list Film recovery actions without rerunning projects.'),
    limit: nonNegativeIntegerSchema('Maximum number of recoverable Film jobs to process this call.'),
    maxAttempts: nonNegativeIntegerSchema('Skip Film jobs whose recovery stage attempt is greater than or equal to this value.'),
    orderBy: enumSchema([...FILM_RECOVERY_ORDER_BY_VALUES], 'Film recovery candidate ordering before applying limit.'),
    runningStaleAfterMs: nonNegativeIntegerSchema('Skip running Film jobs updated more recently than this threshold.'),
    status: enumSchema([...FILM_RECOVERY_STATUS_OPTIONS], 'Film job status filter. active scans failed and running jobs.'),
  }, (args, workspaceDir) => recoverFilmWorkspaceJobs({
    dryRun: readOptionalBoolean(args, 'dryRun'),
    limit: readOptionalNonNegativeInteger(args, 'limit'),
    maxAttempts: readOptionalNonNegativeInteger(args, 'maxAttempts'),
    orderBy: readOptionalEnum(args, 'orderBy', [...FILM_RECOVERY_ORDER_BY_VALUES]),
    runningStaleAfterMs: readOptionalNonNegativeInteger(args, 'runningStaleAfterMs'),
    statuses: resolveFilmRecoverableStatuses(readOptionalEnum(args, 'status', [...FILM_RECOVERY_STATUS_OPTIONS])),
    workspaceDir,
  })),
]

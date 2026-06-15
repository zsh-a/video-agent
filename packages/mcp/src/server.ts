import type {ExportFormat, InitialPipelineStage, ProjectRenderer, ProviderSmokeTestRole} from '@video-agent/runtime'

import {
  checkRuntimeHealth,
  createProviderEnvironmentShellTemplate,
  exportProject,
  ExportQualityError,
  inspectFfmpegAudio,
  listProjectArtifacts,
  listProjects,
  PipelineCheckpointError,
  readProjectArtifact,
  readProjectEvents,
  readProjectQuality,
  readProjectQualityDetails,
  readProjectStatus,
  readProjectVisualSamples,
  readProviderEnvironment,
  readVideoAgentGuidedActions,
  recoverWorkspaceJobs,
  renderProject,
  rerunProject,
  runInitialPipeline,
  runProviderSmokeTest,
  verifyProjectArtifacts,
} from '@video-agent/runtime'
import {ZodError} from 'zod'

export interface McpServerOptions {
  workspaceDir?: string
}

export interface JsonRpcRequest {
  id?: JsonRpcId
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  error?: JsonRpcError
  id: JsonRpcId
  jsonrpc: '2.0'
  result?: unknown
}

export interface JsonRpcError {
  code: number
  data?: unknown
  message: string
}

export type JsonRpcId = null | number | string

export interface McpTool {
  description: string
  inputSchema: JsonSchemaObject
  name: string
}

export interface JsonSchemaObject {
  additionalProperties?: boolean
  properties?: Record<string, unknown>
  required?: string[]
  type: 'object'
}

export interface McpServer {
  handleMessage(message: unknown): Promise<JsonRpcResponse | undefined>
  tools: McpTool[]
}

const STAGE_VALUES: InitialPipelineStage[] = ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality']
const PROVIDER_TEST_ROLES = ['all', 'asr', 'tts', 'vlm'] as const
const TOOL_DEFINITIONS: McpTool[] = [
  createTool('video_agent_doctor', 'Check runtime, workspace, provider config, and media binary health.', {
    env: stringRecordSchema('Explicit environment variables for provider health checks. When set, only these values are checked and current shell environment is ignored.'),
  }),
  createTool('video_agent_list_projects', 'List projects in the video-agent workspace.', {}),
  createTool('video_agent_provider_env', 'Read provider environment variable requirements without exposing configured values.', {
    env: stringRecordSchema('Explicit environment variables to inspect. When set, only these values are checked and current shell environment is ignored.'),
    includeOptional: booleanSchema('When shellTemplate is true, include optional provider variables as active exports. Defaults to commented optional variables.'),
    shellTemplate: booleanSchema('When true, include a non-secret shell export template for the current provider config.'),
  }),
  createTool('video_agent_provider_test', 'Run smoke tests against configured ASR, VLM, and TTS providers.', {
    env: stringRecordSchema('Explicit environment variables for provider smoke tests. When set, only these values are checked and current shell environment is ignored.'),
    framePath: stringSchema('Sample frame path for VLM smoke tests. Defaults to a synthetic placeholder path.'),
    mediaPath: stringSchema('Sample media path for ASR smoke tests. Defaults to a synthetic placeholder path.'),
    role: enumSchema(PROVIDER_TEST_ROLES, 'Provider role to test. Defaults to all.'),
    text: stringSchema('Sample narration text for TTS smoke tests.'),
  }),
  createTool('video_agent_guided_actions', 'Read reusable guided action metadata for a workspace or focused project.', {
    commandPrefix: stringSchema('Command prefix for generated copyable commands, for example "vagent" or "bun run dev". Defaults to vagent.'),
    projectId: stringSchema('Optional project id to focus. Defaults to the most recently updated project when one exists.'),
  }),
  createTool('video_agent_status', 'Read job state, artifact list, provider summary, and quality summary for a project.', {projectId: projectIdSchema()}),
  createTool('video_agent_quality', 'Read project quality, render diagnostics, and artifact integrity summary.', {
    details: booleanSchema('When true, include raw quality-report.json and render-output.json content when present.'),
    projectId: projectIdSchema(),
  }),
  createTool('video_agent_visual_samples', 'Read rendered visual frame sample metadata, optionally including base64 image content.', {
    includeContent: booleanSchema('When true, include base64 JPEG content for each available frame sample. Defaults to metadata only.'),
    projectId: projectIdSchema(),
  }),
  createTool('video_agent_events', 'Read pipeline and provider events for a project.', {
    kind: enumSchema(['pipeline', 'provider'], 'Optional event stream filter.'),
    limit: integerSchema('Maximum number of events to return.'),
    projectId: projectIdSchema(),
    role: enumSchema(['asr', 'tts', 'vlm'], 'Provider role filter for provider events.'),
    stage: stringSchema('Pipeline stage filter for pipeline events, for example ingest, understand, render, or quality.'),
    status: enumSchema(['failed', 'succeeded'], 'Provider call status filter for provider events.'),
    type: enumSchema(['artifact', 'log', 'stage:complete', 'stage:fail', 'stage:retry', 'stage:start'], 'Pipeline event type filter.'),
  }),
  createTool('video_agent_artifacts', 'List project artifacts or read one artifact by name.', {artifactName: stringSchema('Optional artifact filename, such as media-info.json or quality-report.json.'), projectId: projectIdSchema()}),
  createTool('video_agent_verify_artifacts', 'Verify artifact manifest hashes and known IR schemas for a project.', {projectId: projectIdSchema()}),
  createTool('video_agent_run', 'Run the initial pipeline from an input media path.', {
    fromStage: enumSchema(STAGE_VALUES, 'Optional checkpoint stage. Defaults to ingest for a full run.'),
    inputPath: stringSchema('Path to the source media file to inspect and process.'),
    projectId: stringSchema('Optional stable project id. Defaults to a slug generated from the input filename and timestamp.'),
  }),
  createTool('video_agent_rerun', 'Rerun an existing project from a checkpoint stage.', {fromStage: enumSchema(STAGE_VALUES, 'Checkpoint stage to resume from. Defaults to plan.'), projectId: projectIdSchema()}),
  createTool('video_agent_render', 'Render a project with ffmpeg or HyperFrames.', {
    audio: booleanSchema('When false, render without source or voiceover audio. Defaults to true.'),
    audioDucking: booleanSchema('Enable sidechain ducking so voiceover lowers source audio.'),
    duckingAttackMs: numberSchema('Sidechain compressor attack in milliseconds.'),
    duckingRatio: numberSchema('Sidechain compressor ratio.'),
    duckingReleaseMs: numberSchema('Sidechain compressor release in milliseconds.'),
    duckingThreshold: numberSchema('Sidechain compressor threshold in dB.'),
    hyperframesCommand: stringArraySchema('External HyperFrames command prefix, for example ["npx","hyperframes"].'),
    hyperframesOutput: stringSchema('Output path passed to the HyperFrames render command.'),
    hyperframesRender: booleanSchema('When true, invoke the external HyperFrames renderer after generating the HTML project.'),
    hyperframesValidate: booleanSchema('When true, invoke the external HyperFrames validator after generating the HTML project.'),
    output: stringSchema('Output video path for ffmpeg or output directory for HyperFrames.'),
    projectId: projectIdSchema(),
    renderer: enumSchema(['ffmpeg', 'hyperframes'], 'Renderer implementation. Defaults to ffmpeg.'),
    sourceVolume: numberSchema('Source audio volume multiplier.'),
    subtitles: booleanSchema('When false, skip generated subtitle burn-in. Defaults to true for ffmpeg.'),
    voiceoverVolume: numberSchema('Voiceover audio volume multiplier.'),
  }),
  createTool('video_agent_inspect_audio', 'Inspect ffmpeg audio inputs and voiceover alignment without rendering.', {
    audio: booleanSchema('When false, report a disabled audio plan. Defaults to true.'),
    audioDucking: booleanSchema('Inspect audio settings with sidechain ducking enabled.'),
    duckingAttackMs: numberSchema('Sidechain compressor attack in milliseconds.'),
    duckingRatio: numberSchema('Sidechain compressor ratio.'),
    duckingReleaseMs: numberSchema('Sidechain compressor release in milliseconds.'),
    duckingThreshold: numberSchema('Sidechain compressor threshold in dB.'),
    projectId: projectIdSchema(),
    sourceVolume: numberSchema('Source audio volume multiplier.'),
    voiceoverVolume: numberSchema('Voiceover audio volume multiplier.'),
  }),
  createTool('video_agent_export', 'Export final video, HyperFrames directory, or full project bundle.', {
    format: enumSchema(['video', 'hyperframes', 'bundle'], 'Export format. Defaults to video.'),
    outputPath: stringSchema('Destination path for the exported output.'),
    projectId: projectIdSchema(),
    requireQuality: booleanSchema('When true, refuse export unless project quality is clean.'),
  }),
  createTool('video_agent_worker', 'Recover failed or interrupted local pipeline jobs.', {
    dryRun: booleanSchema('When true, list recovery actions without rerunning projects.'),
    limit: integerSchema('Maximum number of recoverable jobs to process this call.'),
    maxAttempts: integerSchema('Skip jobs whose recovery stage attempt is greater than or equal to this value.'),
    orderBy: enumSchema(['attempt', 'oldest', 'recent'], 'Recovery candidate ordering before applying limit.'),
    runningStaleAfterMs: integerSchema('Skip running jobs updated more recently than this threshold.'),
    status: enumSchema(['active', 'failed', 'running'], 'Job status filter. active scans failed and running jobs.'),
  }),
].map((tool) => ({
  ...tool,
  inputSchema: {
    ...tool.inputSchema,
    properties: {
      ...tool.inputSchema.properties,
      workspaceDir: stringSchema('Workspace directory override. Defaults to the MCP server workspace.'),
    },
  },
}))

export function createVideoAgentMcpServer(options: McpServerOptions = {}): McpServer {
  return {
    async handleMessage(message) {
      const request = parseJsonRpcRequest(message)

      if (request.id === undefined || request.method === 'notifications/initialized') {
        return
      }

      try {
        return createJsonRpcResult(request.id, await handleRequest(request, options))
      } catch (error) {
        return createJsonRpcError(request.id, error)
      }
    },
    tools: TOOL_DEFINITIONS,
  }
}

async function handleRequest(request: JsonRpcRequest, options: McpServerOptions): Promise<unknown> {
  if (request.method === 'initialize') {
    return {
      capabilities: {
        tools: {},
      },
      protocolVersion: '2024-11-05',
      serverInfo: {
        name: 'video-agent',
        version: '0.0.0',
      },
    }
  }

  if (request.method === 'tools/list') {
    return {tools: TOOL_DEFINITIONS}
  }

  if (request.method === 'tools/call') {
    return {
      content: [
        {
          text: JSON.stringify(await callTool(parseToolCallParams(request.params), options), null, 2),
          type: 'text',
        },
      ],
    }
  }

  throw new Error(`Unsupported MCP method: ${request.method}`)
}

// MCP tool dispatch stays centralized so tool behavior is easy to audit.
// eslint-disable-next-line complexity
async function callTool(params: ToolCallParams, options: McpServerOptions): Promise<unknown> {
  const args = params.arguments
  const workspaceDir = readOptionalString(args, 'workspaceDir') ?? options.workspaceDir

  switch (params.name) {
    case 'video_agent_artifacts': {
      const projectId = readRequiredString(args, 'projectId')
      const artifactName = readOptionalString(args, 'artifactName')

      return artifactName === undefined ? listProjectArtifacts(projectId, workspaceDir) : readProjectArtifact(projectId, artifactName, workspaceDir)
    }

    case 'video_agent_doctor': {
      return checkRuntimeHealth({env: readOptionalStringRecord(args, 'env'), workspaceDir})
    }

    case 'video_agent_events': {
      return readProjectEvents(readRequiredString(args, 'projectId'), {
        kind: readOptionalEnum(args, 'kind', ['pipeline', 'provider']),
        limit: readOptionalInteger(args, 'limit'),
        pipelineStage: readOptionalString(args, 'stage'),
        pipelineType: readOptionalEnum(args, 'type', ['artifact', 'log', 'stage:complete', 'stage:fail', 'stage:retry', 'stage:start']),
        providerRole: readOptionalEnum(args, 'role', ['asr', 'tts', 'vlm']),
        providerStatus: readOptionalEnum(args, 'status', ['failed', 'succeeded']),
        workspaceDir,
      })
    }

    case 'video_agent_export': {
      return exportProject({
        format: readOptionalEnum(args, 'format', ['video', 'hyperframes', 'bundle']) as ExportFormat | undefined,
        outputPath: readOptionalString(args, 'outputPath'),
        projectId: readRequiredString(args, 'projectId'),
        requireQuality: readOptionalBoolean(args, 'requireQuality'),
        workspaceDir,
      })
    }

    case 'video_agent_guided_actions': {
      return readVideoAgentGuidedActions({
        commandPrefix: readOptionalString(args, 'commandPrefix'),
        projectId: readOptionalString(args, 'projectId'),
        workspaceDir,
      })
    }

    case 'video_agent_inspect_audio': {
      return inspectFfmpegAudio(readRequiredString(args, 'projectId'), {
        audio: readOptionalBoolean(args, 'audio'),
        audioDucking: readOptionalBoolean(args, 'audioDucking'),
        duckingAttackMs: readOptionalNumber(args, 'duckingAttackMs'),
        duckingRatio: readOptionalNumber(args, 'duckingRatio'),
        duckingReleaseMs: readOptionalNumber(args, 'duckingReleaseMs'),
        duckingThreshold: readOptionalNumber(args, 'duckingThreshold'),
        sourceVolume: readOptionalNumber(args, 'sourceVolume'),
        voiceoverVolume: readOptionalNumber(args, 'voiceoverVolume'),
        workspaceDir,
      })
    }

    case 'video_agent_list_projects': {
      return {projects: await listProjects(workspaceDir)}
    }

    case 'video_agent_provider_env': {
      const report = await readProviderEnvironment(workspaceDir, readOptionalStringRecord(args, 'env'))

      if (readOptionalBoolean(args, 'shellTemplate') === true) {
        return {
          report,
          shellTemplate: createProviderEnvironmentShellTemplate(report, {includeOptional: readOptionalBoolean(args, 'includeOptional')}),
        }
      }

      return report
    }

    case 'video_agent_provider_test': {
      return runProviderSmokeTest({
        env: readOptionalStringRecord(args, 'env'),
        framePath: readOptionalString(args, 'framePath'),
        mediaPath: readOptionalString(args, 'mediaPath'),
        roles: resolveProviderSmokeTestRoles(readOptionalEnum(args, 'role', PROVIDER_TEST_ROLES)),
        text: readOptionalString(args, 'text'),
        workspaceDir,
      })
    }

    case 'video_agent_quality': {
      const projectId = readRequiredString(args, 'projectId')

      return readOptionalBoolean(args, 'details') === true ? readProjectQualityDetails(projectId, workspaceDir) : readProjectQuality(projectId, workspaceDir)
    }

    case 'video_agent_render': {
      return renderProject(readRequiredString(args, 'projectId'), {
        audio: readOptionalBoolean(args, 'audio'),
        audioDucking: readOptionalBoolean(args, 'audioDucking'),
        duckingAttackMs: readOptionalNumber(args, 'duckingAttackMs'),
        duckingRatio: readOptionalNumber(args, 'duckingRatio'),
        duckingReleaseMs: readOptionalNumber(args, 'duckingReleaseMs'),
        duckingThreshold: readOptionalNumber(args, 'duckingThreshold'),
        hyperframesCommand: readOptionalStringArray(args, 'hyperframesCommand'),
        hyperframesOutput: readOptionalString(args, 'hyperframesOutput'),
        hyperframesRender: readOptionalBoolean(args, 'hyperframesRender'),
        hyperframesValidate: readOptionalBoolean(args, 'hyperframesValidate'),
        output: readOptionalString(args, 'output'),
        renderer: readOptionalEnum(args, 'renderer', ['ffmpeg', 'hyperframes']) as ProjectRenderer | undefined,
        sourceVolume: readOptionalNumber(args, 'sourceVolume'),
        subtitles: readOptionalBoolean(args, 'subtitles'),
        voiceoverVolume: readOptionalNumber(args, 'voiceoverVolume'),
        workspaceDir,
      })
    }

    case 'video_agent_rerun': {
      return rerunProject(readRequiredString(args, 'projectId'), {
        fromStage: readOptionalEnum(args, 'fromStage', STAGE_VALUES),
        workspaceDir,
      })
    }

    case 'video_agent_run': {
      return runInitialPipeline({
        fromStage: readOptionalEnum(args, 'fromStage', STAGE_VALUES),
        inputPath: readRequiredString(args, 'inputPath'),
        projectId: readOptionalString(args, 'projectId'),
        workspaceDir,
      })
    }

    case 'video_agent_status': {
      return readProjectStatus(readRequiredString(args, 'projectId'), workspaceDir)
    }

    case 'video_agent_verify_artifacts': {
      return verifyProjectArtifacts(readRequiredString(args, 'projectId'), workspaceDir)
    }

    case 'video_agent_visual_samples': {
      return readProjectVisualSamples(readRequiredString(args, 'projectId'), {
        includeContent: readOptionalBoolean(args, 'includeContent'),
        workspaceDir,
      })
    }

    case 'video_agent_worker': {
      return recoverWorkspaceJobs({
        dryRun: readOptionalBoolean(args, 'dryRun'),
        limit: readOptionalInteger(args, 'limit'),
        maxAttempts: readOptionalInteger(args, 'maxAttempts'),
        orderBy: readOptionalEnum(args, 'orderBy', ['attempt', 'oldest', 'recent']),
        runningStaleAfterMs: readOptionalInteger(args, 'runningStaleAfterMs'),
        statuses: resolveRecoverableStatuses(readOptionalEnum(args, 'status', ['active', 'failed', 'running'])),
        workspaceDir,
      })
    }

    default: {
      throw new Error(`Unknown MCP tool: ${params.name}`)
    }
  }
}

interface ToolCallParams {
  arguments: Record<string, unknown>
  name: string
}

function parseToolCallParams(value: unknown): ToolCallParams {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new TypeError('tools/call params must include a string name.')
  }

  return {
    arguments: isRecord(value.arguments) ? value.arguments : {},
    name: value.name,
  }
}

function parseJsonRpcRequest(value: unknown): JsonRpcRequest {
  if (!isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') {
    throw new TypeError('Invalid JSON-RPC request.')
  }

  return {
    ...(isJsonRpcId(value.id) || value.id === undefined ? {id: value.id} : {id: null}),
    jsonrpc: '2.0',
    method: value.method,
    params: value.params,
  }
}

function createJsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    id,
    jsonrpc: '2.0',
    result,
  }
}

function createJsonRpcError(id: JsonRpcId, error: unknown): JsonRpcResponse {
  if (error instanceof PipelineCheckpointError) {
    return {
      error: {
        code: -32_000,
        data: {
          changedArtifacts: error.changedArtifacts,
          code: 'checkpoint_invalid',
          fromStage: error.fromStage,
          missingArtifacts: error.missingArtifacts,
          name: error.name,
          schemaInvalidArtifacts: error.schemaInvalidArtifacts,
          untrackedArtifacts: error.untrackedArtifacts,
        },
        message: error.message,
      },
      id,
      jsonrpc: '2.0',
    }
  }

  if (error instanceof ExportQualityError) {
    return {
      error: {
        code: -32_000,
        data: {
          code: 'export_quality_failed',
          name: error.name,
          projectId: error.projectId,
          quality: error.quality,
        },
        message: error.message,
      },
      id,
      jsonrpc: '2.0',
    }
  }

  if (error instanceof ZodError) {
    return {
      error: {
        code: -32_000,
        data: {
          code: 'validation_error',
          issues: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path.map(String),
          })),
          name: error.name,
        },
        message: 'Validation failed.',
      },
      id,
      jsonrpc: '2.0',
    }
  }

  return {
    error: {
      code: -32_000,
      data: error instanceof Error ? {name: error.name} : undefined,
      message: error instanceof Error ? error.message : String(error),
    },
    id,
    jsonrpc: '2.0',
  }
}

function createTool(name: string, description: string, properties: Record<string, unknown>, required: string[] = requiredFromProperties(properties)): McpTool {
  return {
    description,
    inputSchema: {
      additionalProperties: false,
      properties,
      required,
      type: 'object',
    },
    name,
  }
}

function requiredFromProperties(properties: Record<string, unknown>): string[] {
  return Object.keys(properties).filter((key) => key === 'inputPath' || key === 'projectId')
}

function stringSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    type: 'string',
  }
}

function projectIdSchema(): Record<string, unknown> {
  return stringSchema('Project id inside the video-agent workspace.')
}

function booleanSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    type: 'boolean',
  }
}

function integerSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    minimum: 0,
    type: 'integer',
  }
}

function numberSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    type: 'number',
  }
}

function stringArraySchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    items: {
      type: 'string',
    },
    type: 'array',
  }
}

function stringRecordSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    additionalProperties: {
      type: 'string',
    },
    type: 'object',
  }
}

function enumSchema(values: readonly string[], description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    enum: values,
    type: 'string',
  }
}

function readRequiredString(value: Record<string, unknown>, field: string): string {
  const result = readOptionalString(value, field)

  if (result === undefined || result.trim() === '') {
    throw new TypeError(`MCP tool argument ${field} is required.`)
  }

  return result
}

function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  if (value[field] === undefined || value[field] === null) {
    return undefined
  }

  if (typeof value[field] !== 'string') {
    throw new TypeError(`MCP tool argument ${field} must be a string.`)
  }

  return value[field]
}

function readOptionalBoolean(value: Record<string, unknown>, field: string): boolean | undefined {
  if (value[field] === undefined || value[field] === null) {
    return undefined
  }

  if (typeof value[field] !== 'boolean') {
    throw new TypeError(`MCP tool argument ${field} must be a boolean.`)
  }

  return value[field]
}

function readOptionalInteger(value: Record<string, unknown>, field: string): number | undefined {
  if (value[field] === undefined || value[field] === null) {
    return undefined
  }

  if (!Number.isInteger(value[field]) || (value[field] as number) < 0) {
    throw new TypeError(`MCP tool argument ${field} must be a non-negative integer.`)
  }

  return value[field] as number
}

function readOptionalNumber(value: Record<string, unknown>, field: string): number | undefined {
  if (value[field] === undefined || value[field] === null) {
    return undefined
  }

  if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
    throw new TypeError(`MCP tool argument ${field} must be a finite number.`)
  }

  return value[field]
}

function readOptionalStringArray(value: Record<string, unknown>, field: string): string[] | undefined {
  if (value[field] === undefined || value[field] === null) {
    return undefined
  }

  if (!Array.isArray(value[field]) || !(value[field] as unknown[]).every((item) => typeof item === 'string')) {
    throw new TypeError(`MCP tool argument ${field} must be an array of strings.`)
  }

  return value[field]
}

function readOptionalStringRecord(value: Record<string, unknown>, field: string): Record<string, string> | undefined {
  if (value[field] === undefined || value[field] === null) {
    return undefined
  }

  if (!isRecord(value[field])) {
    throw new TypeError(`MCP tool argument ${field} must be an object of string values.`)
  }

  const record: Record<string, string> = {}

  for (const [key, item] of Object.entries(value[field])) {
    if (typeof item !== 'string') {
      throw new TypeError(`MCP tool argument ${field}.${key} must be a string.`)
    }

    record[key] = item
  }

  return record
}

function readOptionalEnum<T extends string>(value: Record<string, unknown>, field: string, values: readonly T[]): T | undefined {
  if (value[field] === undefined || value[field] === null) {
    return undefined
  }

  if (typeof value[field] === 'string' && values.includes(value[field] as T)) {
    return value[field] as T
  }

  throw new TypeError(`MCP tool argument ${field} must be one of: ${values.join(', ')}.`)
}

function resolveRecoverableStatuses(status: 'active' | 'failed' | 'running' | undefined): Array<'failed' | 'running'> | undefined {
  if (status === undefined || status === 'active') {
    return undefined
  }

  return [status]
}

function resolveProviderSmokeTestRoles(role: typeof PROVIDER_TEST_ROLES[number] | undefined): ProviderSmokeTestRole[] | undefined {
  if (role === undefined || role === 'all') {
    return undefined
  }

  return [role]
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

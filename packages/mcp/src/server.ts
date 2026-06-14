import type {ExportFormat, InitialPipelineStage, ProjectRenderer} from '@video-agent/runtime'

import {
  checkRuntimeHealth,
  exportProject,
  inspectFfmpegAudio,
  listProjectArtifacts,
  listProjects,
  readProjectArtifact,
  readProjectEvents,
  readProjectQuality,
  readProjectStatus,
  readProjectVisualSamples,
  readProviderEnvironment,
  recoverWorkspaceJobs,
  renderProject,
  rerunProject,
  runInitialPipeline,
  verifyProjectArtifacts,
} from '@video-agent/runtime'

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
const TOOL_DEFINITIONS: McpTool[] = [
  createTool('video_agent_doctor', 'Check runtime, workspace, provider config, and media binary health.', {}),
  createTool('video_agent_list_projects', 'List projects in the video-agent workspace.', {}),
  createTool('video_agent_provider_env', 'Read provider environment variable requirements without exposing configured values.', {}),
  createTool('video_agent_status', 'Read job state, artifact list, provider summary, and quality summary for a project.', {projectId: stringSchema()}),
  createTool('video_agent_quality', 'Read project quality, render diagnostics, and artifact integrity summary.', {projectId: stringSchema()}),
  createTool('video_agent_visual_samples', 'Read rendered visual frame sample metadata, optionally including base64 image content.', {includeContent: booleanSchema(), projectId: stringSchema()}),
  createTool('video_agent_events', 'Read pipeline and provider events for a project.', {
    kind: enumSchema(['pipeline', 'provider']),
    limit: integerSchema(),
    projectId: stringSchema(),
    role: enumSchema(['asr', 'tts', 'vlm']),
    status: enumSchema(['failed', 'succeeded']),
  }),
  createTool('video_agent_artifacts', 'List project artifacts or read one artifact by name.', {artifactName: stringSchema(), projectId: stringSchema()}),
  createTool('video_agent_verify_artifacts', 'Verify artifact manifest hashes for a project.', {projectId: stringSchema()}),
  createTool('video_agent_run', 'Run the initial pipeline from an input media path.', {fromStage: enumSchema(STAGE_VALUES), inputPath: stringSchema(), projectId: stringSchema()}),
  createTool('video_agent_rerun', 'Rerun an existing project from a checkpoint stage.', {fromStage: enumSchema(STAGE_VALUES), projectId: stringSchema()}),
  createTool('video_agent_render', 'Render a project with ffmpeg or HyperFrames.', {
    audio: booleanSchema(),
    audioDucking: booleanSchema(),
    duckingAttackMs: numberSchema(),
    duckingRatio: numberSchema(),
    duckingReleaseMs: numberSchema(),
    duckingThreshold: numberSchema(),
    hyperframesCommand: stringArraySchema(),
    hyperframesOutput: stringSchema(),
    hyperframesRender: booleanSchema(),
    hyperframesValidate: booleanSchema(),
    output: stringSchema(),
    projectId: stringSchema(),
    renderer: enumSchema(['ffmpeg', 'hyperframes']),
    sourceVolume: numberSchema(),
    subtitles: booleanSchema(),
    voiceoverVolume: numberSchema(),
  }),
  createTool('video_agent_inspect_audio', 'Inspect ffmpeg audio inputs and voiceover alignment without rendering.', {
    audio: booleanSchema(),
    audioDucking: booleanSchema(),
    duckingAttackMs: numberSchema(),
    duckingRatio: numberSchema(),
    duckingReleaseMs: numberSchema(),
    duckingThreshold: numberSchema(),
    projectId: stringSchema(),
    sourceVolume: numberSchema(),
    voiceoverVolume: numberSchema(),
  }),
  createTool('video_agent_export', 'Export final video, HyperFrames directory, or full project bundle.', {format: enumSchema(['video', 'hyperframes', 'bundle']), outputPath: stringSchema(), projectId: stringSchema(), requireQuality: booleanSchema()}),
  createTool('video_agent_worker', 'Recover failed or interrupted local pipeline jobs.', {dryRun: booleanSchema(), limit: integerSchema(), maxAttempts: integerSchema(), status: enumSchema(['active', 'failed', 'running'])}),
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
      return checkRuntimeHealth({workspaceDir})
    }

    case 'video_agent_events': {
      return readProjectEvents(readRequiredString(args, 'projectId'), {
        kind: readOptionalEnum(args, 'kind', ['pipeline', 'provider']),
        limit: readOptionalInteger(args, 'limit'),
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
      return readProviderEnvironment(workspaceDir)
    }

    case 'video_agent_quality': {
      return readProjectQuality(readRequiredString(args, 'projectId'), workspaceDir)
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

function booleanSchema(): Record<string, unknown> {
  return {type: 'boolean'}
}

function integerSchema(): Record<string, unknown> {
  return {
    minimum: 0,
    type: 'integer',
  }
}

function numberSchema(): Record<string, unknown> {
  return {type: 'number'}
}

function stringArraySchema(): Record<string, unknown> {
  return {
    items: {
      type: 'string',
    },
    type: 'array',
  }
}

function enumSchema(values: readonly string[]): Record<string, unknown> {
  return {
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

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

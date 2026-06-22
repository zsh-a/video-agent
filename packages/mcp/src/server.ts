import {ExportQualityError, PipelineCheckpointError} from '@video-agent/runtime'
import {z, ZodError} from 'zod'

import {callVideoAgentMcpTool, parseToolCallParams, VIDEO_AGENT_MCP_TOOLS, type McpTool} from './tools.js'

export type {JsonSchemaObject, McpTool} from './tools.js'

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

export interface McpServer {
  handleMessage(message: unknown): Promise<JsonRpcResponse | undefined>
  tools: McpTool[]
}

const JsonRpcIdSchema = z.union([z.string(), z.number(), z.null()])

const JsonRpcRequestSchema = z.object({
  id: JsonRpcIdSchema.optional(),
  jsonrpc: z.literal('2.0'),
  method: z.string().min(1),
  params: z.unknown().optional(),
}).strict()

export function createVideoAgentMcpServer(options: McpServerOptions = {}): McpServer {
  return {
    async handleMessage(message) {
      const request = parseJsonRpcRequest(message)

      if (request instanceof JsonRpcRequestParseError) {
        return createJsonRpcProtocolError(null, request)
      }

      if (request.id === undefined || request.method === 'notifications/initialized') {
        return
      }

      try {
        return createJsonRpcResult(request.id, await handleRequest(request, options))
      } catch (error) {
        return createJsonRpcError(request.id, error)
      }
    },
    tools: VIDEO_AGENT_MCP_TOOLS,
  }
}

export function parseJsonRpcMessageBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown
  } catch (error) {
    return new JsonRpcRequestParseError('parse_error', `Invalid JSON-RPC message body: ${error instanceof Error ? error.message : String(error)}`)
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
    return {tools: VIDEO_AGENT_MCP_TOOLS}
  }

  if (request.method === 'tools/call') {
    return {
      content: [
        {
          text: JSON.stringify(await callVideoAgentMcpTool(parseToolCallParams(request.params), options), null, 2),
          type: 'text',
        },
      ],
    }
  }

  throw new JsonRpcRequestParseError('method_not_found', `Unsupported MCP method: ${request.method}`)
}

function parseJsonRpcRequest(value: unknown): JsonRpcRequest | JsonRpcRequestParseError {
  if (value instanceof JsonRpcRequestParseError) {
    return value
  }

  const result = JsonRpcRequestSchema.safeParse(value)

  if (!result.success) {
    return new JsonRpcRequestParseError('invalid_request', 'Invalid JSON-RPC request.', result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String),
    })))
  }

  return result.data
}

function createJsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return {
    id,
    jsonrpc: '2.0',
    result,
  }
}

function createJsonRpcError(id: JsonRpcId, error: unknown): JsonRpcResponse {
  if (error instanceof JsonRpcRequestParseError) {
    return createJsonRpcProtocolError(id, error)
  }

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

function createJsonRpcProtocolError(id: JsonRpcId, error: JsonRpcRequestParseError): JsonRpcResponse {
  return {
    error: {
      code: error.code,
      ...(error.issues === undefined ? {} : {data: {issues: error.issues}}),
      message: error.message,
    },
    id,
    jsonrpc: '2.0',
  }
}

class JsonRpcRequestParseError extends Error {
  readonly code: number
  readonly issues: Array<{code: string; message: string; path: string[]}> | undefined

  constructor(kind: 'invalid_request' | 'method_not_found' | 'parse_error', message: string, issues?: Array<{code: string; message: string; path: string[]}>) {
    super(message)
    this.name = 'JsonRpcRequestParseError'
    this.code = kind === 'parse_error' ? -32_700 : kind === 'invalid_request' ? -32_600 : -32_601
    this.issues = issues
  }
}

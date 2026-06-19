import {ExportQualityError, PipelineCheckpointError} from '@video-agent/runtime'
import {ZodError} from 'zod'

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
    tools: VIDEO_AGENT_MCP_TOOLS,
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

  throw new Error(`Unsupported MCP method: ${request.method}`)
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

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

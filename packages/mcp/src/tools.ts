import type {McpTool, McpToolCallOptions, McpToolDefinition, McpToolHandler, ToolCallParams} from './toolkit.js'

import {DECK_MCP_TOOL_DEFINITIONS} from './deck-tools.js'
import {PROJECT_MCP_TOOL_DEFINITIONS} from './project-tools.js'
import {PROVIDER_MCP_TOOL_DEFINITIONS} from './provider-tools.js'
import {RENDER_MCP_TOOL_DEFINITIONS} from './render-tools.js'
import {readOptionalString, withWorkspaceDirSchema} from './toolkit.js'

export type {JsonSchemaObject, McpTool, McpToolCallOptions, ToolCallParams} from './toolkit.js'
export {parseToolCallParams} from './toolkit.js'

const TOOL_DEFINITIONS: McpToolDefinition[] = [
  ...PROVIDER_MCP_TOOL_DEFINITIONS,
  ...PROJECT_MCP_TOOL_DEFINITIONS,
  ...RENDER_MCP_TOOL_DEFINITIONS,
  ...DECK_MCP_TOOL_DEFINITIONS,
]

export const VIDEO_AGENT_MCP_TOOLS: McpTool[] = TOOL_DEFINITIONS.map((definition) => withWorkspaceDirSchema(definition.tool))

const TOOL_HANDLERS: Record<string, McpToolHandler> = Object.fromEntries(TOOL_DEFINITIONS.map((definition) => [
  definition.tool.name,
  definition.handler,
]))

export async function callVideoAgentMcpTool(params: ToolCallParams, options: McpToolCallOptions = {}): Promise<unknown> {
  const args = params.arguments
  const workspaceDir = readOptionalString(args, 'workspaceDir') ?? options.workspaceDir
  const handler = TOOL_HANDLERS[params.name]

  if (handler === undefined) {
    throw new Error(`Unknown MCP tool: ${params.name}`)
  }

  return handler(args, workspaceDir)
}

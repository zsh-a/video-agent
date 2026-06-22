import {
  isRecord,
  readOptionalBooleanInput,
  readOptionalEnumInput,
  readOptionalNonNegativeIntegerInput,
  readOptionalNumberInput,
  readOptionalPositiveIntegerInput,
  readOptionalStringArrayInput,
  readOptionalStringInput,
  readOptionalStringRecordInput,
} from '@video-agent/runtime'

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

export interface McpToolCallOptions {
  workspaceDir?: string
}

export interface ToolCallParams {
  arguments: Record<string, unknown>
  name: string
}

export type McpToolHandler = (args: Record<string, unknown>, workspaceDir: string | undefined) => Promise<unknown> | unknown

export interface McpToolDefinition {
  handler: McpToolHandler
  tool: McpTool
}

const MCP_ARGUMENT_READER = {
  createError: createMcpArgumentError,
  label: 'MCP tool argument',
}

export function createToolDefinition(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  handler: McpToolHandler,
  required: string[] = requiredFromProperties(properties),
): McpToolDefinition {
  return {
    handler,
    tool: {
      description,
      inputSchema: {
        additionalProperties: false,
        properties,
        required,
        type: 'object',
      },
      name,
    },
  }
}

export function withWorkspaceDirSchema(tool: McpTool): McpTool {
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
        workspaceDir: stringSchema('Workspace directory override. Defaults to the MCP server workspace.'),
      },
    },
  }
}

export function parseToolCallParams(value: unknown): ToolCallParams {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new TypeError('tools/call params must include a string name.')
  }

  return {
    arguments: isRecord(value.arguments) ? value.arguments : {},
    name: value.name,
  }
}

export function stringSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    type: 'string',
  }
}

export function projectIdSchema(): Record<string, unknown> {
  return stringSchema('Project id inside the video-agent workspace.')
}

export function booleanSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    type: 'boolean',
  }
}

export function nonNegativeIntegerSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    minimum: 0,
    type: 'integer',
  }
}

export function positiveIntegerSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    minimum: 1,
    type: 'integer',
  }
}

export function numberSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    type: 'number',
  }
}

export function commandArraySchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    items: {
      minLength: 1,
      type: 'string',
    },
    minItems: 1,
    type: 'array',
  }
}

export function stringRecordSchema(description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    additionalProperties: {
      type: 'string',
    },
    type: 'object',
  }
}

export function enumSchema(values: readonly string[], description?: string): Record<string, unknown> {
  return {
    ...(description === undefined ? {} : {description}),
    enum: values,
    type: 'string',
  }
}

export function readRequiredString(value: Record<string, unknown>, field: string): string {
  const result = readOptionalString(value, field)

  if (result === undefined || result.trim() === '') {
    throw new TypeError(`MCP tool argument ${field} is required.`)
  }

  return result
}

export function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  return readOptionalStringInput(value, field, MCP_ARGUMENT_READER)
}

export function readOptionalBoolean(value: Record<string, unknown>, field: string): boolean | undefined {
  return readOptionalBooleanInput(value, field, MCP_ARGUMENT_READER)
}

export function readOptionalNonNegativeInteger(value: Record<string, unknown>, field: string): number | undefined {
  return readOptionalNonNegativeIntegerInput(value, field, MCP_ARGUMENT_READER)
}

export function readOptionalPositiveInteger(value: Record<string, unknown>, field: string): number | undefined {
  return readOptionalPositiveIntegerInput(value, field, MCP_ARGUMENT_READER)
}

export function readOptionalNumber(value: Record<string, unknown>, field: string): number | undefined {
  return readOptionalNumberInput(value, field, MCP_ARGUMENT_READER)
}

export function readOptionalCommandArray(value: Record<string, unknown>, field: string): string[] | undefined {
  return readOptionalStringArrayInput(value, field, {
    ...MCP_ARGUMENT_READER,
    allowEmpty: false,
    allowEmptyItems: false,
    description: 'a non-empty string array',
  })
}

export function readOptionalStringRecord(value: Record<string, unknown>, field: string): Record<string, string> | undefined {
  return readOptionalStringRecordInput(value, field, MCP_ARGUMENT_READER)
}

export function readOptionalEnum<T extends string>(value: Record<string, unknown>, field: string, values: readonly T[]): T | undefined {
  return readOptionalEnumInput(value, field, values, MCP_ARGUMENT_READER)
}

export function readRequiredEnum<T extends string>(value: Record<string, unknown>, field: string, values: readonly T[]): T {
  const result = readOptionalEnum(value, field, values)

  if (result === undefined) {
    throw new TypeError(`MCP tool argument ${field} is required and must be one of: ${values.join(', ')}.`)
  }

  return result
}

function requiredFromProperties(properties: Record<string, unknown>): string[] {
  return Object.keys(properties).filter((key) => key === 'inputPath' || key === 'projectId')
}

function createMcpArgumentError(message: string): TypeError {
  return new TypeError(message)
}

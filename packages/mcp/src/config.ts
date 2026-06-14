export type McpClientConfigMode = 'dev' | 'installed'
export type McpClientConfigPreset = 'claude-desktop' | 'cursor' | 'generic' | 'server-entry'
export type McpClientConfigShape = 'full' | 'server'

export interface McpClientConfigOptions {
  client?: McpClientConfigPreset
  env?: Record<string, string>
  mode?: McpClientConfigMode
  serverName?: string
  workspaceDir?: string
}

export interface McpClientConfig {
  mcpServers: Record<string, McpClientServerConfig>
}

export interface McpClientConfigPresetInfo {
  client: McpClientConfigPreset
  description: string
  placement: string
  shape: McpClientConfigShape
}

export interface McpClientServerConfig {
  args: string[]
  command: string
  env?: Record<string, string>
}

export function createMcpClientConfig(options: McpClientConfigOptions = {}): McpClientConfig {
  const serverName = options.serverName ?? 'video-agent'

  return {
    mcpServers: {
      [serverName]: createMcpClientServerConfig(options),
    },
  }
}

export function createMcpClientConfigOutput(
  options: McpClientConfigOptions & {shape?: McpClientConfigShape} = {},
): McpClientConfig | McpClientServerConfig {
  if (resolveConfigShape(options) === 'server') {
    return createMcpClientServerConfig(options)
  }

  return createMcpClientConfig(options)
}

export function getMcpClientConfigPresetInfo(client: McpClientConfigPreset = 'generic'): McpClientConfigPresetInfo {
  const shape = resolveConfigShape({client})

  if (client === 'server-entry') {
    return {
      client,
      description: 'Server entry only for clients whose UI or config file already supplies the MCP server name.',
      placement: 'Paste the returned command/args/env object inside the host-provided server entry.',
      shape,
    }
  }

  if (client === 'claude-desktop') {
    return {
      client,
      description: 'Full common MCP JSON object for Claude Desktop-style configuration.',
      placement: 'Paste the returned mcpServers object into the client MCP JSON configuration.',
      shape,
    }
  }

  if (client === 'cursor') {
    return {
      client,
      description: 'Full common MCP JSON object for Cursor-style configuration.',
      placement: 'Paste the returned mcpServers object into the client MCP JSON configuration.',
      shape,
    }
  }

  return {
    client,
    description: 'Full common MCP JSON object for clients that accept an mcpServers map.',
    placement: 'Paste the returned mcpServers object into the client MCP JSON configuration.',
    shape,
  }
}

function resolveConfigShape(options: McpClientConfigOptions & {shape?: McpClientConfigShape}): McpClientConfigShape {
  if (options.shape !== undefined) {
    return options.shape
  }

  if (options.client === 'server-entry') {
    return 'server'
  }

  return 'full'
}

function createMcpClientServerConfig(options: McpClientConfigOptions): McpClientServerConfig {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const env = normalizeEnv(options.env)

  if ((options.mode ?? 'dev') === 'installed') {
    return {
      args: ['mcp', '--workspace', workspaceDir],
      command: 'vagent',
      ...(env === undefined ? {} : {env}),
    }
  }

  return {
    args: ['run', 'dev', 'mcp', '--workspace', workspaceDir],
    command: 'bun',
    ...(env === undefined ? {} : {env}),
  }
}

function normalizeEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (env === undefined || Object.keys(env).length === 0) {
    return undefined
  }

  return Object.fromEntries(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)))
}

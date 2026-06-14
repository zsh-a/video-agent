export type McpClientConfigMode = 'dev' | 'installed'
export type McpClientConfigShape = 'full' | 'server'

export interface McpClientConfigOptions {
  env?: Record<string, string>
  mode?: McpClientConfigMode
  serverName?: string
  workspaceDir?: string
}

export interface McpClientConfig {
  mcpServers: Record<string, McpClientServerConfig>
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
  if ((options.shape ?? 'full') === 'server') {
    return createMcpClientServerConfig(options)
  }

  return createMcpClientConfig(options)
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

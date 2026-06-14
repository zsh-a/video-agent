export type McpClientConfigMode = 'dev' | 'installed'

export interface McpClientConfigOptions {
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
}

export function createMcpClientConfig(options: McpClientConfigOptions = {}): McpClientConfig {
  const serverName = options.serverName ?? 'video-agent'

  return {
    mcpServers: {
      [serverName]: createMcpClientServerConfig(options),
    },
  }
}

function createMcpClientServerConfig(options: McpClientConfigOptions): McpClientServerConfig {
  const workspaceDir = options.workspaceDir ?? '.video-agent'

  if ((options.mode ?? 'dev') === 'installed') {
    return {
      args: ['mcp', '--workspace', workspaceDir],
      command: 'vagent',
    }
  }

  return {
    args: ['run', 'dev', 'mcp', '--workspace', workspaceDir],
    command: 'bun',
  }
}

import {Command, Flags} from '@oclif/core'
import {
  createMcpClientConfigOutput,
  type McpClientConfigMode,
  type McpClientConfigShape,
  startMcpStdioServer,
} from '@video-agent/mcp'

export default class Mcp extends Command {
  static description = 'Start the video-agent MCP server over stdio'
  static flags = {
    'config-mode': Flags.string({
      default: 'dev',
      description: 'Client config command mode for --print-config',
      options: ['dev', 'installed'],
    }),
    'config-shape': Flags.string({
      default: 'full',
      description: 'Client config JSON shape for --print-config',
      options: ['full', 'server'],
    }),
    env: Flags.string({
      description: 'Environment variable for --print-config, formatted as KEY=VALUE',
      multiple: true,
    }),
    'print-config': Flags.boolean({description: 'Print a generic MCP client stdio configuration instead of starting the server'}),
    'server-name': Flags.string({default: 'video-agent', description: 'MCP server name for --print-config'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Mcp)

    if (flags['print-config']) {
      this.log(
        JSON.stringify(
          createMcpClientConfigOutput({
            env: parseEnvFlags(flags.env ?? []),
            mode: flags['config-mode'] as McpClientConfigMode,
            serverName: flags['server-name'],
            shape: flags['config-shape'] as McpClientConfigShape,
            workspaceDir: flags.workspace,
          }),
          null,
          2,
        ),
      )
      return
    }

    startMcpStdioServer({workspaceDir: flags.workspace})
  }
}

export function parseEnvFlags(values: string[]): Record<string, string> {
  const env: Record<string, string> = {}

  for (const value of values) {
    const separatorIndex = value.indexOf('=')

    if (separatorIndex <= 0) {
      throw new Error(`Invalid --env value "${value}". Expected KEY=VALUE.`)
    }

    const key = value.slice(0, separatorIndex).trim()

    if (key.length === 0) {
      throw new Error(`Invalid --env value "${value}". Expected KEY=VALUE.`)
    }

    env[key] = value.slice(separatorIndex + 1)
  }

  return env
}

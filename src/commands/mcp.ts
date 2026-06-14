import {Command, Flags} from '@oclif/core'
import {
  createMcpClientConfigOutput,
  getMcpClientConfigPresetInfo,
  type McpClientConfigMode,
  type McpClientConfigPreset,
  type McpClientConfigShape,
  startMcpStdioServer,
} from '@video-agent/mcp'

import {parseEnvFlags} from '../utils/env-flags.js'

export default class Mcp extends Command {
  static description = 'Start the video-agent MCP server over stdio'
  static flags = {
    client: Flags.string({
      default: 'generic',
      description: 'Client preset for --print-config',
      options: ['claude-desktop', 'cursor', 'generic', 'server-entry'],
    }),
    'config-mode': Flags.string({
      default: 'dev',
      description: 'Client config command mode for --print-config',
      options: ['dev', 'installed'],
    }),
    'config-shape': Flags.string({
      description: 'Client config JSON shape for --print-config',
      options: ['full', 'server'],
    }),
    env: Flags.string({
      description: 'Environment variable for --print-config, formatted as KEY=VALUE',
      multiple: true,
    }),
    'print-config': Flags.boolean({description: 'Print a generic MCP client stdio configuration instead of starting the server'}),
    'print-config-info': Flags.boolean({description: 'Print placement guidance for a client config preset instead of starting the server'}),
    'server-name': Flags.string({default: 'video-agent', description: 'MCP server name for --print-config'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Mcp)
    const client = flags.client as McpClientConfigPreset

    if (flags['print-config-info']) {
      this.log(JSON.stringify(getMcpClientConfigPresetInfo(client), null, 2))
      return
    }

    if (flags['print-config']) {
      this.log(
        JSON.stringify(
          createMcpClientConfigOutput({
            client,
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

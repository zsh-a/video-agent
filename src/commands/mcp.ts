import {Command, Flags} from '@oclif/core'
import {
  createMcpClientConfigOutput,
  getMcpClientConfigPresetInfo,
  listMcpClientConfigPresetInfo,
  MCP_CLIENT_CONFIG_MODES,
  MCP_CLIENT_CONFIG_SHAPES,
  type McpClientConfigMode,
  type McpClientConfigPreset,
  type McpClientConfigShape,
  startMcpStdioServer,
  supportedMcpClientConfigPresets,
} from '@video-agent/mcp'
import {parseEnvAssignments} from '@video-agent/runtime'

import {parseOptionalEnumFlag, parseRequiredEnumFlag, workspaceFlag} from '../utils/cli-flags.js'

export default class Mcp extends Command {
  static description = 'Start the video-agent MCP server over stdio'
  static flags = {
    client: Flags.string({
      default: 'generic',
      description: 'Client preset for --print-config',
      options: [...supportedMcpClientConfigPresets],
    }),
    'config-mode': Flags.string({
      default: 'dev',
      description: 'Client config command mode for --print-config',
      options: [...MCP_CLIENT_CONFIG_MODES],
    }),
    'config-shape': Flags.string({
      description: 'Client config JSON shape for --print-config',
      options: [...MCP_CLIENT_CONFIG_SHAPES],
    }),
    env: Flags.string({
      description: 'Environment variable for --print-config, formatted as KEY=VALUE',
      multiple: true,
    }),
    'list-client-presets': Flags.boolean({description: 'Print all supported MCP client config presets instead of starting the server'}),
    'print-config': Flags.boolean({description: 'Print a generic MCP client stdio configuration instead of starting the server'}),
    'print-config-info': Flags.boolean({description: 'Print placement guidance for a client config preset instead of starting the server'}),
    'server-name': Flags.string({default: 'video-agent', description: 'MCP server name for --print-config'}),
    workspace: workspaceFlag(),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Mcp)
    const client = parseRequiredEnumFlag<McpClientConfigPreset>(flags.client, supportedMcpClientConfigPresets, '--client')

    if (flags['list-client-presets']) {
      this.log(JSON.stringify(listMcpClientConfigPresetInfo(), null, 2))
      return
    }

    if (flags['print-config-info']) {
      this.log(JSON.stringify(getMcpClientConfigPresetInfo(client), null, 2))
      return
    }

    if (flags['print-config']) {
      this.log(
        JSON.stringify(
          createMcpClientConfigOutput({
            client,
            env: parseEnvAssignments(flags.env ?? [], '--env value'),
            mode: parseRequiredEnumFlag<McpClientConfigMode>(flags['config-mode'], MCP_CLIENT_CONFIG_MODES, '--config-mode'),
            serverName: flags['server-name'],
            shape: parseOptionalEnumFlag<McpClientConfigShape>(flags['config-shape'], MCP_CLIENT_CONFIG_SHAPES, '--config-shape'),
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

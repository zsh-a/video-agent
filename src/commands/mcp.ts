import {Command, Flags} from '@oclif/core'
import {createMcpClientConfig, type McpClientConfigMode, startMcpStdioServer} from '@video-agent/mcp'

export default class Mcp extends Command {
  static description = 'Start the video-agent MCP server over stdio'
  static flags = {
    'config-mode': Flags.string({
      default: 'dev',
      description: 'Client config command mode for --print-config',
      options: ['dev', 'installed'],
    }),
    'print-config': Flags.boolean({description: 'Print a generic MCP client stdio configuration instead of starting the server'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Mcp)

    if (flags['print-config']) {
      this.log(
        JSON.stringify(
          createMcpClientConfig({
            mode: flags['config-mode'] as McpClientConfigMode,
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

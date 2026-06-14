/* eslint-disable n/no-unsupported-features/node-builtins */
import {Command, Flags} from '@oclif/core'
import {createApiFetchHandler} from '@video-agent/api'

interface BunServer {
  hostname: string
  port: number
  url: URL
}

interface BunRuntime {
  serve(options: {fetch(request: Request): Promise<Response> | Response; hostname: string; port: number}): BunServer
}

export default class Serve extends Command {
  static description = 'Start a Bun HTTP API server for video-agent runtime state'
  static flags = {
    host: Flags.string({default: '127.0.0.1', description: 'Host to bind'}),
    json: Flags.boolean({description: 'Print machine-readable startup output'}),
    port: Flags.integer({default: 4317, description: 'Port to bind'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(Serve)
    const bun = getBunRuntime()

    if (bun === undefined) {
      throw new Error('The API server requires Bun runtime. Use `bun run dev serve`.')
    }

    const server = bun.serve({
      fetch: createApiFetchHandler({workspaceDir: flags.workspace}),
      hostname: flags.host,
      port: flags.port,
    })
    const output = {
      host: server.hostname,
      port: server.port,
      url: server.url.toString(),
      workspaceDir: flags.workspace,
    }

    if (flags.json) {
      this.log(JSON.stringify(output, null, 2))
      return
    }

    this.log(`API: ${output.url}`)
    this.log(`Workspace: ${output.workspaceDir}`)
  }
}

function getBunRuntime(): BunRuntime | undefined {
  return (globalThis as typeof globalThis & {Bun?: BunRuntime}).Bun
}

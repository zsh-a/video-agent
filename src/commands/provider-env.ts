import {Command, Flags} from '@oclif/core'
import {readProviderEnvironment} from '@video-agent/runtime'

export default class ProviderEnv extends Command {
  static description = 'Show provider environment variables required by the current config'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProviderEnv)
    const report = await readProviderEnvironment(flags.workspace)

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    this.log(`Workspace: ${report.workspaceDir}`)

    for (const provider of report.providers) {
      this.log(`${provider.role}: ${provider.provider}`)

      if (provider.requirements.length === 0) {
        this.log('  no environment variables required')
        continue
      }

      for (const requirement of provider.requirements) {
        this.log(`  ${requirement.env}\t${requirement.required ? 'required' : 'optional'}\t${requirement.configured ? 'configured' : 'missing'}\t${requirement.description}`)
      }
    }
  }
}

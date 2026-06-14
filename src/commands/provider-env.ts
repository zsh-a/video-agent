import {Command, Flags} from '@oclif/core'
import {createProviderEnvironmentShellTemplate, readProviderEnvironment} from '@video-agent/runtime'

import {parseEnvFlags} from './env-flags.js'

export default class ProviderEnv extends Command {
  static description = 'Show provider environment variables required by the current config'
  static flags = {
    env: Flags.string({
      description: 'Environment variable to use for provider checks, formatted as KEY=VALUE. Repeatable; when set, only explicit values are inspected.',
      multiple: true,
    }),
    'include-optional': Flags.boolean({description: 'Include optional provider variables as active exports in --shell-template output'}),
    json: Flags.boolean({description: 'Print machine-readable output'}),
    'shell-template': Flags.boolean({description: 'Print a shell export template for the current provider config'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(ProviderEnv)
    const report = await readProviderEnvironment(flags.workspace, flags.env === undefined ? undefined : parseEnvFlags(flags.env))

    if (flags.json) {
      this.log(JSON.stringify(report, null, 2))
      return
    }

    if (flags['shell-template']) {
      this.log(createProviderEnvironmentShellTemplate(report, {includeOptional: flags['include-optional']}).trimEnd())
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

import {Args, Command, Flags} from '@oclif/core'
import {listProjectArtifacts, readProjectArtifact, verifyProjectArtifacts} from '@video-agent/runtime'

export default class Artifacts extends Command {
  /* eslint-disable perfectionist/sort-objects */
  static args = {
    project: Args.string({description: 'Project id to inspect', required: true}),
    artifact: Args.string({description: 'Artifact filename to read'}),
  }
  /* eslint-enable perfectionist/sort-objects */
  static description = 'List or read project artifacts'
  static flags = {
    json: Flags.boolean({description: 'Print machine-readable output'}),
    verify: Flags.boolean({description: 'Verify artifact files against artifact-manifest.json'}),
    workspace: Flags.string({default: '.video-agent', description: 'Workspace directory'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(Artifacts)

    if (flags.verify) {
      const result = await verifyProjectArtifacts(args.project, flags.workspace)

      if (flags.json) {
        this.log(JSON.stringify(result, null, 2))
        return
      }

      this.log(`Manifest: ${result.manifestPath}`)
      this.log(`Checked: ${result.checked}`)
      this.log(`Status: ${result.ok ? 'ok' : 'failed'}`)

      for (const issue of result.missing) {
        this.log(`Missing: ${issue.name}`)
      }

      for (const issue of result.changed) {
        this.log(`Changed: ${issue.name}`)
      }

      for (const issue of result.schemaInvalid) {
        this.log(`Schema invalid: ${issue.name}`)

        for (const schemaIssue of issue.issues) {
          this.log(`  ${schemaIssue.path.join('.') || '<root>'}: ${schemaIssue.message}`)
        }
      }

      for (const artifact of result.untracked) {
        this.log(`Untracked: ${artifact}`)
      }

      return
    }

    if (args.artifact !== undefined) {
      const result = await readProjectArtifact(args.project, args.artifact, flags.workspace)

      this.log(JSON.stringify(result, null, 2))
      return
    }

    const artifacts = await listProjectArtifacts(args.project, flags.workspace)

    if (flags.json) {
      this.log(JSON.stringify({artifacts}, null, 2))
      return
    }

    if (artifacts.length === 0) {
      this.log('No artifacts found.')
      return
    }

    for (const artifact of artifacts) {
      this.log(`${artifact.name}\t${artifact.kind}\t${artifact.size}`)
    }
  }
}

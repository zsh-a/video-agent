import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {createVideoAgentGuidedActions, readVideoAgentGuidedActions} from '../../../packages/runtime/src/guided-actions.js'

describe('guided actions', () => {
  it('creates sorted workspace actions without a selected project', () => {
    const actions = createVideoAgentGuidedActions({
      commandPrefix: 'vagent',
      workspaceDir: 'workspace dir',
    })

    expect(actions.map((action) => action.id)).to.deep.equal([
      'provider-test',
      'worker-dry-run',
      'list-projects',
    ])
    expect(actions.map((action) => action.command)).to.include("vagent worker --dry-run --workspace 'workspace dir'")
  })

  it('reads project actions with quoted artifact and project arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-guided-actions-'))

    try {
      await createProject(root, 'demo project')

      const result = await readVideoAgentGuidedActions({
        commandPrefix: 'bun run dev',
        projectId: 'demo project',
        workspaceDir: root,
      })

      expect(result.projectId).to.equal('demo project')
      expect(result.actions.map((action) => action.id).slice(0, 4)).to.deep.equal([
        'open-dashboard',
        'rerun-suggested-stage',
        'watch-dashboard',
        'inspect-status',
      ])
      expect(result.actions.find((action) => action.id === 'rerun-suggested-stage')).to.include({
        category: 'rerun',
        description: 'Rerun the focused project from the first unfinished stage, quality.',
      })
      expect(result.actions.find((action) => action.id === 'inspect-quality-details')).to.include({
        category: 'inspect',
        description: 'Inspect aggregate quality with raw quality-report and render-output details.',
      })
      expect(result.actions.find((action) => action.id === 'inspect-audio')).to.include({
        category: 'inspect',
        description: 'Inspect ffmpeg audio inputs and voiceover alignment without rendering.',
      })
      expect(result.actions.find((action) => action.id === 'export-hyperframes-clean')).to.include({
        category: 'export',
        description: 'Export the HyperFrames render directory after cleaning stale output files and passing project quality.',
        label: 'Export clean HyperFrames',
      })
      expect(result.actions.map((action) => action.command)).to.include(`bun run dev tui --project 'demo project' --action artifact --artifact 'quality report.json' --workspace ${root}`)
      expect(result.actions.map((action) => action.command)).to.include(`bun run dev quality 'demo project' --details --json --workspace ${root}`)
      expect(result.actions.map((action) => action.command)).to.include(`bun run dev artifacts 'demo project' --verify --workspace ${root}`)
      expect(result.actions.map((action) => action.command)).to.include(`bun run dev visual 'demo project' --json --workspace ${root}`)
      expect(result.actions.map((action) => action.command)).to.include(`bun run dev tui --project 'demo project' --action audio --workspace ${root}`)
      expect(result.actions.map((action) => action.command)).to.include(`bun run dev export 'demo project' --require-quality --workspace ${root}`)
      expect(result.actions.map((action) => action.command)).to.include(`bun run dev export 'demo project' --format hyperframes --clean-output --require-quality --workspace ${root}`)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')

  await mkdir(artifactsDir, {recursive: true})
  const store = new JsonJobStore(join(projectDir, 'job-state.json'))

  await store.initialize({
    inputPath: join(root, 'input.mp4'),
    projectId,
    stages: ['ingest', 'quality'],
  })
  await store.updateStage('ingest', 'completed')
  await writeFile(join(artifactsDir, 'quality report.json'), '{"ok":true}\n')
}

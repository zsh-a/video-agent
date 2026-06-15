import {expect} from '#test/expect'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createProjectId, createProjectWorkspace} from '../../../packages/runtime/src/workspace.js'

describe('workspace', () => {
  it('creates deterministic project ids from media names and timestamps', () => {
    const id = createProjectId('/videos/My Demo Clip.mp4', new Date('2026-06-14T12:34:56.000Z'))

    expect(id).to.equal('my-demo-clip-20260614123456')
  })

  it('creates project directories and writes JSON artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-test-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const artifactPath = await workspace.store.writeJson('example.json', {ok: true})
      const artifact = await workspace.store.readJson<{ok: boolean}>('example.json')
      const manifest = JSON.parse(await readFile(join(workspace.artifactsDir, 'artifact-manifest.json'), 'utf8')) as {artifacts: Array<{name: string; sha256: string}>}

      expect(workspace.projectId).to.equal('demo')
      expect(artifactPath).to.contain('example.json')
      expect(artifact.ok).to.equal(true)
      expect(manifest.artifacts[0].name).to.equal('example.json')
      expect(manifest.artifacts[0].sha256).to.match(/^[a-f0-9]{64}$/)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

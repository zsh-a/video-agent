import {expect} from '#test/expect'
import {readJson, writeText} from '#test/fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createProjectId, createProjectWorkspace} from '../../../packages/runtime/src/shared/workspace.js'

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
      const artifact = await workspace.store.readJson('example.json')
      const manifest = await readJson<{artifacts: Array<{name: string; sha256: string}>}>(join(workspace.artifactsDir, 'artifact-manifest.json'))

      expect(workspace.projectId).to.equal('demo')
      expect(artifactPath).to.contain('example.json')
      expect(artifact).to.deep.equal({ok: true})
      expect(manifest.artifacts[0].name).to.equal('example.json')
      expect(manifest.artifacts[0].sha256).to.match(/^[a-f0-9]{64}$/)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed artifact JSON through the workspace store boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-test-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      let error: unknown

      await writeText(workspace.store.resolve('bad.json'), 'not json\n')

      try {
        await workspace.store.readJson('bad.json')
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('Project artifact "bad.json" is invalid JSON')
      expect(String(error)).to.include('no artifact store JSON fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

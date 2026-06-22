import {expect} from '#test/expect'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createProjectWorkspace} from '../../../packages/runtime/src/shared/workspace.js'
import {removeDeckHtmlFrameArtifacts} from '../../../packages/pipeline-deck/src/render/final/cleanup.js'

describe('Deck render cleanup', () => {
  it('ignores missing artifact directories but does not swallow unexpected readdir errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-render-cleanup-'))

    try {
      const workspace = await createProjectWorkspace({projectId: 'demo', workspaceDir: root})

      await rm(workspace.artifactsDir, {force: true, recursive: true})
      await removeDeckHtmlFrameArtifacts(workspace)

      await writeFile(workspace.artifactsDir, 'not a directory')

      await removeDeckHtmlFrameArtifacts(workspace)
      throw new Error('Expected deck cleanup to fail when artifacts path is not a directory.')
    } catch (error) {
      expect(String(error)).to.include('ENOTDIR')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

import {expect} from '#test/expect'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {createProjectAgentRuntime} from '../../../packages/runtime/src/project/agent-runtime.js'
import {createProjectWorkspace} from '../../../packages/runtime/src/shared/workspace.js'

describe('project agent runtime', () => {
  it('marks running job stages and the job run failed when the agent run fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const jobStore = new JsonJobStore(join(workspace.projectDir, 'job-state.json'))
      const agent = createProjectAgentRuntime({
        jobStore,
        workspace,
      })

      await jobStore.initialize({
        inputPath: '/tmp/input.md',
        projectId: 'demo',
        stages: ['script', 'render'],
      })
      await agent.startStage('script', 'Writing script')
      await agent.failRun(new Error('coherence rewrite exhausted'))

      const state = await jobStore.read()

      expect(state.status).to.equal('failed')
      expect(state.completedAt).to.be.a('string')
      expect(state.stages.find((stage) => stage.name === 'script')).to.deep.include({
        message: 'coherence rewrite exhausted',
        status: 'failed',
      })
      expect(state.stages.find((stage) => stage.name === 'render')?.status).to.equal('pending')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

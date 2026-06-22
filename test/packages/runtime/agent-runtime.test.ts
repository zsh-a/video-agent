import {expect} from '#test/expect'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {PIPELINE_EVENT_AGENT_STEP_START, PIPELINE_EVENT_LOG} from '../../../packages/core/src/index.js'
import {createProjectAgentRuntime} from '../../../packages/runtime/src/project/agent-runtime.js'
import {readProjectEvents} from '../../../packages/runtime/src/project/events-reader.js'
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
        pipeline: 'deck',
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

  it('records skipped stages in job state and pipeline events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-skip-'))

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
        pipeline: 'deck',
        projectId: 'demo',
        stages: ['ingest', 'transcribe'],
      })
      await agent.completeStage('ingest')
      await agent.skipStage('transcribe', 'Text input does not require transcription')

      const state = await jobStore.read()
      const events = await readProjectEvents('demo', {
        kind: 'pipeline',
        pipelineType: 'stage:skip',
        workspaceDir: root,
      })

      expect(state.status).to.equal('completed')
      expect(state.stages.find((stage) => stage.name === 'transcribe')).to.deep.include({
        message: 'Text input does not require transcription',
        status: 'skipped',
      })
      expect(events.events[0]?.event).to.deep.include({
        message: 'Text input does not require transcription',
        stage: 'transcribe',
        type: 'stage:skip',
      })
      expect(events.events[0]?.event.agentRunId).to.equal(undefined)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects emitted agentRunId overrides instead of reconciling event ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-override-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const jobStore = new JsonJobStore(join(workspace.projectDir, 'job-state.json'))
      const agent = createProjectAgentRuntime({
        jobStore,
        runId: 'agent-run-1',
        workspace,
      })
      let error: unknown

      try {
        await agent.emit({
          agentRunId: 'other-run',
          level: 'info',
          message: 'Bad override',
          type: PIPELINE_EVENT_LOG,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no emitted event run-id override fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects emitted timestamp overrides instead of trusting caller event time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-time-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const jobStore = new JsonJobStore(join(workspace.projectDir, 'job-state.json'))
      const agent = createProjectAgentRuntime({
        jobStore,
        runId: 'agent-run-1',
        workspace,
      })
      let error: unknown

      try {
        await agent.emit({
          level: 'info',
          message: 'Bad timestamp',
          time: '2020-01-01T00:00:00.000Z',
          type: PIPELINE_EVENT_LOG,
        } as never)
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no emitted timestamp override fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects public agent lifecycle events instead of bypassing runStep ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-public-agent-event-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const jobStore = new JsonJobStore(join(workspace.projectDir, 'job-state.json'))
      const agent = createProjectAgentRuntime({
        jobStore,
        runId: 'agent-run-1',
        workspace,
      })
      let error: unknown

      try {
        await agent.emit({
          agentStepId: 'step-1',
          level: 'info',
          stage: 'script',
          step: 'Forged step',
          type: PIPELINE_EVENT_AGENT_STEP_START,
        } as never)
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('external agent event fallback')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects unclean public event text instead of trimming event fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-event-text-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const jobStore = new JsonJobStore(join(workspace.projectDir, 'job-state.json'))
      const agent = createProjectAgentRuntime({
        jobStore,
        runId: 'agent-run-1',
        workspace,
      })
      let error: unknown

      try {
        await agent.emit({
          level: 'info',
          message: ' Bad event text ',
          type: PIPELINE_EVENT_LOG,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no event text cleanup fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed step names before mutating job state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-step-text-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const jobStore = new JsonJobStore(join(workspace.projectDir, 'job-state.json'))
      const agent = createProjectAgentRuntime({
        jobStore,
        runId: 'agent-run-1',
        workspace,
      })

      await jobStore.initialize({
        inputPath: '/tmp/input.md',
        pipeline: 'deck',
        projectId: 'demo',
        stages: ['script'],
      })

      let error: unknown

      try {
        await agent.runStep({
          fn: async () => 'done',
          stage: 'script',
          step: ' Bad step ',
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no event text cleanup fallback is allowed')
      expect((await jobStore.read()).stages[0]?.status).to.equal('pending')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects explicit malformed run ids instead of cleaning them before event writes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-agent-runtime-runid-'))

    try {
      const workspace = await createProjectWorkspace({
        projectId: 'demo',
        workspaceDir: root,
      })
      const jobStore = new JsonJobStore(join(workspace.projectDir, 'job-state.json'))

      expect(() => createProjectAgentRuntime({
        jobStore,
        runId: ' agent-run-1 ',
        workspace,
      })).to.throw('no agent run id cleanup fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

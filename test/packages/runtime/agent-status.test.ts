import {expect} from '#test/expect'

import {
  PIPELINE_EVENT_AGENT_RUN_START,
  PIPELINE_EVENT_AGENT_STEP_COMPLETE,
  PIPELINE_EVENT_AGENT_STEP_START,
  PIPELINE_EVENT_STAGE_START,
} from '../../../packages/core/src/index.js'
import {summarizeAgentEvents} from '../../../packages/runtime/src/project/agent-status.js'

describe('project agent status', () => {
  it('does not synthesize agent runs from non-agent stage events', () => {
    const status = summarizeAgentEvents([
      {
        agentRunId: 'run-1',
        projectId: 'demo',
        stage: 'ingest',
        time: '2026-06-20T00:00:00.000Z',
        type: PIPELINE_EVENT_STAGE_START,
      },
    ])

    expect(status).to.deep.equal({
      currentRun: undefined,
      runs: [],
    })
  })

  it('rejects malformed agent step events instead of skipping or naming them by id', () => {
    expect(() => summarizeAgentEvents([
      {
        agentRunId: 'run-1',
        projectId: 'demo',
        stage: 'script',
        step: 'Writing script',
        time: '2026-06-20T00:00:00.000Z',
        type: PIPELINE_EVENT_AGENT_STEP_START,
      },
    ])).to.throw('agent:step:start.agentStepId')
  })

  it('rejects completed agent step events without duration instead of leaving timing unknown', () => {
    expect(() => summarizeAgentEvents([
      {
        agentRunId: 'run-1',
        message: 'Run started',
        projectId: 'demo',
        time: '2026-06-20T00:00:00.000Z',
        type: PIPELINE_EVENT_AGENT_RUN_START,
      },
      {
        agentRunId: 'run-1',
        agentStepId: 'step-1',
        projectId: 'demo',
        stage: 'script',
        step: 'Writing script',
        time: '2026-06-20T00:00:01.000Z',
        type: PIPELINE_EVENT_AGENT_STEP_START,
      },
      {
        agentRunId: 'run-1',
        agentStepId: 'step-1',
        projectId: 'demo',
        stage: 'script',
        step: 'Writing script',
        time: '2026-06-20T00:00:02.000Z',
        type: PIPELINE_EVENT_AGENT_STEP_COMPLETE,
      },
    ])).to.throw('agent:step:complete.durationMs')
  })
})

import type {PipelineEvent} from '@video-agent/core'
import type {ProviderCallStartRecord} from '@video-agent/runtime'

import {expect} from '#test/expect'
import {renderToString} from 'ink'
import {createElement as h} from 'react'

import {AgentRunProgressApp} from '../../src/ui/agent-run-renderer.js'
import {applyPipelineEvent, applyProviderCallStart, createAgentRunProgressState} from '../../src/ui/agent-run-state.js'

describe('agent run progress renderer', () => {
  it('renders the run context, current stage progress, and provider activity', () => {
    let state = createAgentRunProgressState(Date.parse('2026-06-18T00:00:00.000Z'), {
      inputPath: '/tmp/input.mp4',
      workspaceDir: '/tmp/workspace',
    })

    state = applyPipelineEvent(state, pipelineEvent({
      stage: 'understand',
      time: '2026-06-18T00:00:01.000Z',
      type: 'stage:start',
    }))
    state = applyPipelineEvent(state, pipelineEvent({
      current: 2,
      stage: 'understand',
      step: 'vlm',
      time: '2026-06-18T00:00:02.000Z',
      total: 4,
      type: 'stage:progress',
      unit: 'frames',
    }))
    state = applyProviderCallStart(state, providerStart({
      operation: 'analyzeScenes',
      provider: 'mock',
      requestId: 'request-1',
      role: 'vlm',
      startedAt: '2026-06-18T00:00:02.000Z',
    }))

    const output = renderToString(h(AgentRunProgressApp, {
      now: Date.parse('2026-06-18T00:00:03.000Z'),
      state,
    }), {
      columns: 120,
    })

    expect(output).to.include('video-agent run')
    expect(output).to.include('input')
    expect(output).to.include('/tmp/input.mp4')
    expect(output).to.include('workspace')
    expect(output).to.include('/tmp/workspace')
    expect(output).to.include('understand.vlm')
    expect(output).to.include('50%')
    expect(output).to.include('2/4 frames')
    expect(output).to.include('provider')
    expect(output).to.include('vlm/mock')
    expect(output).to.include('analyzeScenes')
  })
})

function pipelineEvent(event: Partial<PipelineEvent> & Pick<PipelineEvent, 'time' | 'type'>): PipelineEvent {
  return {
    projectId: 'demo',
    ...event,
  }
}

function providerStart(call: Omit<ProviderCallStartRecord, 'input' | 'status' | 'version'>): ProviderCallStartRecord {
  return {
    input: {},
    status: 'started',
    version: 1,
    ...call,
  }
}

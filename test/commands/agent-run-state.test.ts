import type {PipelineEvent} from '@video-agent/core'
import type {ProviderCallRecord, ProviderCallStartRecord} from '@video-agent/runtime'

import {expect} from '#test/expect'

import {
  applyPipelineEvent,
  applyProviderCall,
  applyProviderCallStart,
  completeAgentRunProgressState,
  createAgentRunProgressState,
  failAgentRunProgressState,
  getCurrentStage,
} from '../../src/ui/agent-run-state.js'

describe('agent run progress state', () => {
  it('tracks stage progress and completed transcript entries', () => {
    let state = createAgentRunProgressState(Date.parse('2026-06-18T00:00:00.000Z'))

    state = applyPipelineEvent(state, pipelineEvent({
      stage: 'ingest',
      time: '2026-06-18T00:00:01.000Z',
      type: 'stage:start',
    }))
    state = applyPipelineEvent(state, pipelineEvent({
      current: 2,
      stage: 'ingest',
      time: '2026-06-18T00:00:02.000Z',
      total: 4,
      type: 'stage:progress',
      unit: 'files',
    }))
    state = applyPipelineEvent(state, pipelineEvent({
      stage: 'ingest',
      time: '2026-06-18T00:00:05.000Z',
      type: 'stage:complete',
    }))

    const ingest = state.stages.find((stage) => stage.name === 'ingest')

    expect(ingest?.status).to.equal('completed')
    expect(ingest?.percent).to.equal(100)
    expect(ingest?.current).to.equal(2)
    expect(ingest?.total).to.equal(4)
    expect(ingest?.unit).to.equal('files')
    expect(state.transcript.map((entry) => entry.text)).to.deep.equal(['ingest completed in 4s'])
    expect(getCurrentStage(state)?.name).to.equal('understand')
  })

  it('tracks provider calls and failed run state', () => {
    let state = createAgentRunProgressState(Date.parse('2026-06-18T00:00:00.000Z'))

    state = applyProviderCallStart(state, providerStart({
      operation: 'analyzeScenes',
      provider: 'mock',
      requestId: 'request-1',
      role: 'vlm',
      startedAt: '2026-06-18T00:00:01.000Z',
    }))
    state = applyProviderCall(state, providerCall({
      completedAt: '2026-06-18T00:00:03.500Z',
      durationMs: 2500,
      operation: 'analyzeScenes',
      provider: 'mock',
      requestId: 'request-1',
      role: 'vlm',
      startedAt: '2026-06-18T00:00:01.000Z',
      status: 'failed',
    }))
    state = failAgentRunProgressState(state, new Error('boom'), Date.parse('2026-06-18T00:00:04.000Z'))

    expect(state.providerCalls).to.have.length(1)
    expect(state.providerCalls[0]?.status).to.equal('failed')
    expect(state.providerCalls[0]?.durationMs).to.equal(2500)
    expect(state.status).to.equal('failed')
    expect(state.transcript.map((entry) => entry.text)).to.deep.equal([
      'vlm mock analyzeScenes failed 2s',
      'run failed: boom',
    ])
  })

  it('records completion summary without changing adapter output contracts', () => {
    const state = completeAgentRunProgressState(createAgentRunProgressState(Date.parse('2026-06-18T00:00:00.000Z'), {
      inputPath: '/tmp/input.mp4',
      workspaceDir: '/tmp/workspace',
    }), {
      artifactCount: 3,
      projectDir: '/tmp/project',
      projectId: 'demo',
      status: 'completed',
    }, Date.parse('2026-06-18T00:00:10.000Z'))

    expect(state.projectId).to.equal('demo')
    expect(state.inputPath).to.equal('/tmp/input.mp4')
    expect(state.workspaceDir).to.equal('/tmp/workspace')
    expect(state.projectDir).to.equal('/tmp/project')
    expect(state.status).to.equal('succeeded')
    expect(state.transcript.map((entry) => entry.text)).to.deep.equal(['run completed project=demo artifacts=3'])
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

function providerCall(call: Omit<ProviderCallRecord, 'input' | 'version'>): ProviderCallRecord {
  return {
    input: {},
    version: 1,
    ...call,
  }
}

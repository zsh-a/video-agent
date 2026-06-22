import {expect} from '#test/expect'

import {createRunViewModel} from '../../../packages/studio/src/view-models/run-status.js'
import type {DashboardData} from '../../../packages/studio/src/types.js'

describe('Studio run status view model', () => {
  it('uses agent steps as the primary run timeline', () => {
    const data = createDashboardData({
      projectStatus: {
        agent: {
          currentRun: {
            runId: 'run-1',
            startedAt: '2026-06-20T00:00:00.000Z',
            status: 'running',
            steps: [
              {
                completedAt: '2026-06-20T00:00:01.000Z',
                name: 'content-analysis',
                stage: 'understand',
                startedAt: '2026-06-20T00:00:00.000Z',
                status: 'completed',
              },
              {
                current: 3,
                message: 'Analyzing source chunk 3/5',
                name: 'content-analysis',
                stage: 'understand',
                startedAt: '2026-06-20T00:00:01.000Z',
                status: 'running',
                total: 5,
                unit: 'chunks',
              },
            ],
          },
          runs: [],
        },
        job: {
          pipeline: 'deck',
          stages: [],
          status: 'running',
        },
        summary: {
          events: {count: 0},
          quality: {errors: 0, issues: 0, warnings: 0},
          render: {rendered: false},
        },
      },
    })

    const view = createRunViewModel(data, 'deck-demo')

    expect(view.status).to.equal('running')
    expect(view.currentStep?.message).to.equal('Analyzing source chunk 3/5')
    expect(view.progress).to.deep.include({current: 3, total: 5, unit: 'chunks'})
    expect(view.stageGroups.map((group) => group.name)).to.deep.equal(['understand'])
    expect(view.stageGroups[0]?.status).to.equal('running')
  })

  it('falls back to job stages when no agent run exists', () => {
    const data = createDashboardData({
      projectStatus: {
        job: {
          pipeline: 'deck',
          stages: [
            {name: 'ingest', status: 'completed'},
            {message: 'Rendering frames', name: 'render', percent: 40, status: 'running'},
          ],
          status: 'running',
        },
      },
    })

    const view = createRunViewModel(data, 'deck-demo')

    expect(view.status).to.equal('running')
    expect(view.stageGroups.map((group) => group.name)).to.deep.equal(['ingest', 'render'])
    expect(view.stageGroups[1]?.steps[0]?.message).to.equal('Rendering frames')
  })

  it('does not coerce obsolete status aliases', () => {
    const data = createDashboardData({
      projectStatus: {
        job: {
          pipeline: 'deck',
          stages: [{name: 'render', status: 'complete'}],
          status: 'error',
        },
      },
    })

    const view = createRunViewModel(data, 'deck-demo')

    expect(view.status).to.equal('idle')
    expect(view.stageGroups[0]?.status).to.equal('pending')
    expect(view.stageGroups[0]?.steps[0]?.status).to.equal('running')
  })

  it('summarizes project outputs for the run header', () => {
    const data = createDashboardData({
      artifacts: [
        {kind: 'json', name: 'deck.json', size: 10},
        {kind: 'video', name: 'final.mp4', size: 20},
      ],
      providerReport: {
        llmTraces: [
          {durationMs: 10, operation: 'generateObject', requestId: '1', status: 'completed'},
        ],
      },
    })

    const view = createRunViewModel(data, 'deck-demo')

    expect(view.outputs).to.deep.equal({
      artifacts: 2,
      llmCalls: 1,
      qualityErrors: 0,
      qualityWarnings: 1,
      renderReady: true,
    })
  })
})

function createDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    actions: [],
    artifacts: [],
    events: [],
    projectStatus: {
      job: {
        pipeline: 'deck',
        stages: [],
        status: 'completed',
      },
      summary: {
        events: {count: 0},
        quality: {errors: 0, issues: 1, warnings: 1},
        render: {rendered: true, renderer: 'remotion'},
      },
    },
    projects: [{projectId: 'deck-demo', status: 'completed', updatedAt: '2026-06-20T00:00:00.000Z'}],
    providerReport: {},
    visualSamples: [],
    ...overrides,
  }
}

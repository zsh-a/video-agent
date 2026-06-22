import {expect} from '#test/expect'

import {formatProjectStatus} from '../../src/utils/status-output.js'

describe('status command', () => {
  it('formats complete render diagnostics', () => {
    expect(formatProjectStatus({
      artifacts: ['quality-report.json'],
      job: {
        createdAt: '2026-06-15T00:00:00.000Z',
        inputPath: '/tmp/input.mp4',
        projectId: 'demo',
        stages: [
          {
            name: 'render',
            status: 'completed',
          },
        ],
        status: 'completed',
        updatedAt: '2026-06-15T00:00:00.000Z',
        version: 1,
      },
      projectDir: '/tmp/demo',
      projectId: 'demo',
      summary: {
        events: {
          count: 2,
          last: {
            stage: 'render',
            type: 'stage:complete',
          },
        },
        providers: {
          byRole: {
            asr: {costs: {}, failed: 0, succeeded: 1, total: 1},
            tts: {costs: {}, failed: 0, succeeded: 0, total: 0},
            vlm: {costs: {}, failed: 0, succeeded: 0, total: 0},
          },
          costs: {},
          failed: 0,
          succeeded: 1,
          total: 1,
        },
        quality: {
          errors: 1,
          issues: 3,
          warnings: 2,
        },
        render: {
          audioInputs: 1,
          audioQualityErrors: 2,
          audioQualityWarnings: 3,
          audioWarnings: 4,
          missingVoiceovers: 5,
          outputErrors: 6,
          outputWarnings: 7,
          rendered: true,
          renderer: 'ffmpeg',
          reviewAvailable: true,
          reviewHtml: 'renders/review/index.html',
          reviewReport: 'artifacts/review-report.json',
          subtitleErrors: 8,
          subtitleWarnings: 9,
          templateErrors: 10,
          templateWarnings: 11,
          visualErrors: 12,
          visualWarnings: 13,
        },
      },
    })).to.equal([
      'Project: demo',
      'Status: completed',
      'Artifacts: 1',
      'Events: 2',
      'Provider calls: 1 (0 failed)',
      'Quality issues: 3 (1 errors, 2 warnings)',
      'Render: rendered, 38 errors, 52 warnings, output 6/7, subtitle 8/9, audio 2/12, template 10/11, visual 12/13, review available',
      'Last event: stage:complete:render',
      'render: completed',
    ].join('\n'))
  })
})

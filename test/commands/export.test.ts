import {expect} from '#test/expect'

import type {ProjectQualityReport} from '../../packages/runtime/src/project-quality.js'

import {createExportQualityFailurePayload, formatExportQualityFailure} from '../../src/commands/export.js'

describe('export command', () => {
  it('formats quality gate failures with actionable diagnostics', () => {
    const quality = createProjectQualityReport()

    expect(formatExportQualityFailure('demo', quality)).to.equal([
      'Export blocked: project demo did not pass quality checks.',
      'Quality: 36 errors, 48 warnings',
      'Pipeline: 2 errors, 3 warnings',
      'Content: 0 errors, 0 warnings',
      'Render: rendered, 33 errors, 45 warnings, output 5/6, subtitle 7/8, audio 1/9, template 9/10, visual 11/12, review none',
      'Artifacts: not ok (1 changed, 1 missing, 1 schema invalid, 2 untracked)',
    ].join('\n'))
  })

  it('creates machine-readable quality gate failures aligned with API and MCP errors', () => {
    const quality = createProjectQualityReport()
    const result = createExportQualityFailurePayload('demo', quality, 'Project demo did not pass quality checks.')

    expect(result).to.deep.include({
      ok: false,
      projectId: 'demo',
    })
    expect(result.error).to.deep.equal({
      code: 'export_quality_failed',
      message: 'Project demo did not pass quality checks.',
      name: 'ExportQualityError',
    })
    expect(result.quality).to.equal(quality)
  })
})

function createProjectQualityReport(): ProjectQualityReport {
  return {
    artifacts: {
      changed: [{
        actualSha256: 'actual',
        actualSize: 12,
        expectedSha256: 'expected',
        expectedSize: 10,
        name: 'timeline.json',
      }],
      checked: 3,
      manifestPath: '/tmp/artifact-manifest.json',
      missing: [{name: 'narration.json', reason: 'missing'}],
      ok: false,
      schemaInvalid: [{issues: [{code: 'invalid_type', message: 'Required', path: ['scenes']}], name: 'storyboard.json'}],
      summary: {
        changed: 1,
        checked: 3,
        errors: 3,
        missing: 1,
        schemaInvalid: 1,
        untracked: 2,
        warnings: 2,
      },
      untracked: ['render-output.json', 'quality-report.json'],
    },
    content: {
      errors: 0,
      issues: 0,
      warnings: 0,
    },
    generatedAt: '2026-06-15T00:00:00.000Z',
    ok: false,
    pipeline: {
      errors: 2,
      issues: 5,
      warnings: 3,
    },
    projectId: 'demo',
    render: {
      audioInputs: 1,
      audioQualityErrors: 1,
      audioQualityWarnings: 2,
      audioWarnings: 3,
      missingVoiceovers: 4,
      outputErrors: 5,
      outputWarnings: 6,
      rendered: true,
      renderer: 'ffmpeg',
      reviewAvailable: false,
      subtitleErrors: 7,
      subtitleWarnings: 8,
      templateErrors: 9,
      templateWarnings: 10,
      visualErrors: 11,
      visualWarnings: 12,
    },
    summary: {
      errors: 36,
      warnings: 48,
    },
  }
}

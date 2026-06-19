import {expect} from '#test/expect'

import {formatWorkerResult} from '../../src/commands/worker.js'

describe('worker command', () => {
  it('formats checkpoint artifact diagnostics in human-readable output', () => {
    expect(formatWorkerResult({
      changedArtifacts: ['timeline.json'],
      error: 'Checkpoint IR validation failed.',
      fromStage: 'quality-check',
      missingArtifacts: ['narration.json'],
      projectId: 'demo',
      schemaInvalidArtifacts: ['clip-plan.json'],
      skipReason: 'checkpoint-invalid',
      status: 'skipped',
      untrackedArtifacts: ['render-plan.json'],
      validationIssues: [
        {
          code: 'too_small',
          message: 'Too small: expected string to have >=1 characters',
          path: ['source'],
        },
      ],
    })).to.equal('demo\tskipped\tquality-check\tcheckpoint-invalid\tCheckpoint IR validation failed.; missing: narration.json; changed: timeline.json; schema invalid: clip-plan.json; untracked: render-plan.json; source: Too small: expected string to have >=1 characters')
  })
})

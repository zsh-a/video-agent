import {expect} from '#test/expect'

import {PipelineCheckpointError} from '../../packages/runtime/src/project/checkpoint.js'
import {createCheckpointErrorPayload, formatCheckpointFailure} from '../../src/utils/checkpoint-errors.js'

describe('checkpoint CLI errors', () => {
  it('formats checkpoint failures for terminal output', () => {
    const error = new PipelineCheckpointError('quality', {
      changedArtifacts: ['timeline.json'],
      missingArtifacts: ['ingest-report.json', 'tts-segments.json'],
      schemaInvalidArtifacts: ['clip-plan.json'],
      untrackedArtifacts: ['narration.json'],
    })

    expect(formatCheckpointFailure(error)).to.equal([
      'Checkpoint blocked: cannot resume from quality.',
      'Missing artifacts: ingest-report.json, tts-segments.json',
      'Changed artifacts: timeline.json',
      'Schema invalid artifacts: clip-plan.json',
      'Untracked required artifacts: narration.json',
      'Message: Cannot resume from quality; checkpoint artifact issue(s): missing: ingest-report.json, tts-segments.json; changed: timeline.json; schema invalid: clip-plan.json; untracked: narration.json.',
    ].join('\n'))
  })

  it('creates machine-readable checkpoint failure payloads', () => {
    const error = new PipelineCheckpointError('voiceover', {
      missingArtifacts: ['narration.json'],
    })

    expect(createCheckpointErrorPayload(error)).to.deep.equal({
      error: {
        changedArtifacts: [],
        code: 'checkpoint_invalid',
        fromStage: 'voiceover',
        message: 'Cannot resume from voiceover; checkpoint artifact issue(s): missing: narration.json.',
        missingArtifacts: ['narration.json'],
        name: 'PipelineCheckpointError',
        schemaInvalidArtifacts: [],
        untrackedArtifacts: [],
      },
    })
  })
})

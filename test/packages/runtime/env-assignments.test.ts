import {expect} from '#test/expect'

import {normalizeEnvAssignments, parseEnvAssignments} from '../../../packages/runtime/src/shared/env-assignments.js'

describe('env assignments', () => {
  it('parses repeated KEY=VALUE inputs', () => {
    expect(parseEnvAssignments(['VIDEO_AGENT_ASR_COMMAND=asr-provider', 'EMPTY='], '--env value')).to.deep.equal({
      EMPTY: '',
      VIDEO_AGENT_ASR_COMMAND: 'asr-provider',
    })
  })

  it('rejects invalid env assignment syntax', () => {
    expect(() => parseEnvAssignments(['VIDEO_AGENT_ASR_COMMAND'], '--env value')).to.throw('Expected KEY=VALUE')
  })

  it('normalizes optional env records for adapter config output', () => {
    expect(normalizeEnvAssignments(undefined)).to.equal(undefined)
    expect(normalizeEnvAssignments({})).to.equal(undefined)
    expect(normalizeEnvAssignments({
      VIDEO_AGENT_TTS_COMMAND: 'tts-provider',
      VIDEO_AGENT_ASR_COMMAND: 'asr-provider',
    })).to.deep.equal({
      VIDEO_AGENT_ASR_COMMAND: 'asr-provider',
      VIDEO_AGENT_TTS_COMMAND: 'tts-provider',
    })
  })
})

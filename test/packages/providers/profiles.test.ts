import {expect} from 'chai'

import {getProviderProfile, MIMO_PROVIDER_BASE_URL, MIMO_PROVIDER_MODELS, MIMO_PROVIDER_PROFILE, PROVIDER_PROFILE_NAMES} from '../../../packages/providers/src/index.js'

describe('provider profiles', () => {
  it('defines the Mimo hosted provider defaults', () => {
    expect(PROVIDER_PROFILE_NAMES).to.deep.equal(['mimo'])
    expect(getProviderProfile('mimo')).to.equal(MIMO_PROVIDER_PROFILE)
    expect(MIMO_PROVIDER_BASE_URL).to.equal('https://token-plan-cn.xiaomimimo.com/anthropic')
    expect(MIMO_PROVIDER_PROFILE.providers).to.deep.equal({
      asr: 'http',
      tts: 'http',
      vlm: 'http',
    })
    expect(MIMO_PROVIDER_PROFILE.providerEnv).to.include({
      VIDEO_AGENT_ASR_MODEL: 'mimo-v2.5-asr',
      VIDEO_AGENT_ASR_URL: MIMO_PROVIDER_BASE_URL,
      VIDEO_AGENT_TTS_MODEL: 'mimo-v2.5-tts',
      VIDEO_AGENT_TTS_URL: MIMO_PROVIDER_BASE_URL,
      VIDEO_AGENT_VLM_MODEL: 'mimo-v2.5-pro',
      VIDEO_AGENT_VLM_URL: MIMO_PROVIDER_BASE_URL,
    })
  })

  it('keeps the known Mimo model catalog', () => {
    expect(MIMO_PROVIDER_MODELS.map((model) => model.id)).to.deep.equal([
      'mimo-v2.5-pro',
      'mimo-v2.5',
      'mimo-v2.5-asr',
      'mimo-v2.5-tts-voiceclone',
      'mimo-v2.5-tts-voicedesign',
      'mimo-v2.5-tts',
      'mimo-v2-pro',
      'mimo-v2-omni',
      'mimo-v2-tts',
    ])
  })
})

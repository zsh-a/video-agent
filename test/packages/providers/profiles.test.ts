import {expect} from '#test/expect'

import {getProviderProfile, MIMO_PROVIDER_BASE_URL, MIMO_PROVIDER_MODEL_IDS, MIMO_PROVIDER_MODELS, MIMO_PROVIDER_PROFILE, PROVIDER_PROFILE_NAMES} from '../../../packages/providers/src/index.js'

describe('provider profiles', () => {
  it('defines the Mimo hosted provider defaults', () => {
    expect(PROVIDER_PROFILE_NAMES).to.deep.equal(['mimo'])
    expect(getProviderProfile('mimo')).to.equal(MIMO_PROVIDER_PROFILE)
    expect(MIMO_PROVIDER_BASE_URL).to.equal('https://token-plan-cn.xiaomimimo.com/v1')
    expect(MIMO_PROVIDER_PROFILE.providers).to.deep.equal({
      asr: 'llm',
      tts: 'llm',
      vlm: 'llm',
    })
    expect(MIMO_PROVIDER_PROFILE.llm).to.deep.equal({
      apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
      baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
      model: MIMO_PROVIDER_MODEL_IDS.llm,
      name: 'mimo',
      provider: 'openai-compatible',
      supportsStructuredOutputs: false,
    })
    expect(MIMO_PROVIDER_PROFILE.providerSettings).to.deep.equal({})
  })

  it('keeps one model catalog source for all Mimo roles', () => {
    expect(MIMO_PROVIDER_MODELS.map((model) => model.id)).to.deep.equal([
      MIMO_PROVIDER_MODEL_IDS.llm,
      MIMO_PROVIDER_MODEL_IDS.asr,
      MIMO_PROVIDER_MODEL_IDS.tts,
    ])
    expect(MIMO_PROVIDER_MODELS.map((model) => model.roles)).to.deep.equal([['llm'], ['asr'], ['tts']])
  })
})

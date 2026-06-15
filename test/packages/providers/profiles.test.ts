import {expect} from 'chai'

import {getProviderProfile, MIMO_PROVIDER_BASE_URL, MIMO_PROVIDER_MODELS, MIMO_PROVIDER_PROFILE, PROVIDER_PROFILE_NAMES} from '../../../packages/providers/src/index.js'

describe('provider profiles', () => {
  it('defines the Mimo hosted provider defaults', () => {
    expect(PROVIDER_PROFILE_NAMES).to.deep.equal(['mimo'])
    expect(getProviderProfile('mimo')).to.equal(MIMO_PROVIDER_PROFILE)
    expect(MIMO_PROVIDER_BASE_URL).to.equal('https://token-plan-cn.xiaomimimo.com/anthropic/v1')
    expect(MIMO_PROVIDER_PROFILE.providers).to.deep.equal({
      asr: 'llm',
      tts: 'llm',
      vlm: 'llm',
    })
    expect(MIMO_PROVIDER_PROFILE.providerSettings).to.deep.equal({})
  })

  it('keeps a single LLM model catalog entry', () => {
    expect(MIMO_PROVIDER_MODELS.map((model) => model.id)).to.deep.equal([
      'mimo-v2.5-pro',
    ])
    expect(MIMO_PROVIDER_MODELS.map((model) => model.roles)).to.deep.equal([['llm']])
  })
})

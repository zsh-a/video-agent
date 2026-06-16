import {expect} from '#test/expect'

import {createProviders, createVlmProvider} from '../../../packages/providers/src/registry.js'

const LLM_CONFIG = {
  apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
  baseURL: 'https://llm.example.test/v1',
  model: 'test-model',
  provider: 'openai-compatible' as const,
}

describe('provider registry', () => {
  it('creates an LLM client from provider config when callers do not inject one', () => {
    const providers = createProviders({
      llm: LLM_CONFIG,
      providerEnv: {
        VIDEO_AGENT_LLM_TOKEN: 'test-token',
      },
      providers: {
        asr: 'mock',
        tts: 'mock',
        vlm: 'llm',
      },
    })

    expect(providers).to.have.keys(['asr', 'script', 'storyboard', 'tts', 'vlm'])
  })

  it('lets direct role factories resolve LLM clients from llmConfig and env', () => {
    const provider = createVlmProvider('llm', {
      env: {
        VIDEO_AGENT_LLM_TOKEN: 'test-token',
      },
      llmConfig: LLM_CONFIG,
    })

    expect(provider).to.have.property('analyzeScenes')
  })

  it('still reports llm providers without any LLM configuration', () => {
    expect(() => createProviders({
      providers: {
        asr: 'mock',
        tts: 'mock',
        vlm: 'llm',
      },
    })).to.throw('Provider vlm is set to llm, but LLM is not configured.')
  })
})

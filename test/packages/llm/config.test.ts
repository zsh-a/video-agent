import {expect} from 'chai'

import {createLanguageModelFromConfig, createLLMClientFromConfig} from '../../../packages/llm/src/index.js'

describe('LLM config factory', () => {
  it('creates an AI SDK Anthropic-compatible model from config', () => {
    const model = createLanguageModelFromConfig({
      authTokenEnv: 'VIDEO_AGENT_LLM_TOKEN',
      baseURL: 'https://llm.example.test/anthropic',
      model: 'mimo-v2.5-pro',
      name: 'mimo',
      provider: 'anthropic',
    }, {
      env: {
        VIDEO_AGENT_LLM_TOKEN: 'test-token',
      },
    })

    const modelMetadata = model as {modelId: string; provider: string; specificationVersion: string}

    expect(modelMetadata.provider).to.equal('mimo')
    expect(modelMetadata.modelId).to.equal('mimo-v2.5-pro')
    expect(modelMetadata.specificationVersion).to.equal('v3')
  })

  it('returns no client when LLM config is not set', () => {
    expect(createLLMClientFromConfig()).to.equal(undefined)
  })
})

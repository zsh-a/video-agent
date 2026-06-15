import {expect} from 'chai'

import {BUILTIN_PROVIDER_NAMES, getProviderEnvironmentDefinitions, isProviderName, PROVIDER_ROLES, providerEnvName} from '../../../packages/providers/src/index.js'

describe('provider descriptors', () => {
  it('defines stable built-in provider names and role ordering', () => {
    expect(BUILTIN_PROVIDER_NAMES).to.deep.equal(['command', 'llm', 'mock'])
    expect(PROVIDER_ROLES).to.deep.equal(['asr', 'vlm', 'tts'])
    expect(isProviderName('llm')).to.equal(true)
    expect(isProviderName('http')).to.equal(false)
    expect(isProviderName('hosted-service')).to.equal(false)
  })

  it('describes command provider environment requirements', () => {
    expect(getProviderEnvironmentDefinitions('asr', 'command')).to.deep.equal([
      {
        description: 'ASR command adapter argv as a JSON string array.',
        env: 'VIDEO_AGENT_ASR_COMMAND',
        kind: 'commandArgvJson',
        placeholder: '["node","./providers/adapter.js"]',
        required: true,
        secret: false,
      },
    ])
  })

  it('describes llm provider as using shared LLM config', () => {
    expect(getProviderEnvironmentDefinitions('tts', 'llm')).to.deep.equal([])
  })

  it('builds provider env names consistently', () => {
    expect(providerEnvName('vlm', 'COMMAND')).to.equal('VIDEO_AGENT_VLM_COMMAND')
  })
})

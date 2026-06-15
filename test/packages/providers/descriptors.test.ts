import {expect} from 'chai'

import {BUILTIN_PROVIDER_NAMES, getProviderEnvironmentDefinitions, isProviderName, PROVIDER_ROLES, providerEnvName} from '../../../packages/providers/src/index.js'

describe('provider descriptors', () => {
  it('defines stable built-in provider names and role ordering', () => {
    expect(BUILTIN_PROVIDER_NAMES).to.deep.equal(['command', 'http', 'mock'])
    expect(PROVIDER_ROLES).to.deep.equal(['asr', 'vlm', 'tts'])
    expect(isProviderName('http')).to.equal(true)
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

  it('describes HTTP provider environment requirements without real secret values', () => {
    const requirements = getProviderEnvironmentDefinitions('tts', 'http')

    expect(requirements.map((requirement) => requirement.env)).to.deep.equal([
      'VIDEO_AGENT_TTS_URL',
      'VIDEO_AGENT_TTS_TOKEN',
      'VIDEO_AGENT_TTS_HEADERS',
      'VIDEO_AGENT_TTS_TIMEOUT_MS',
    ])
    expect(requirements.filter((requirement) => requirement.secret).map((requirement) => requirement.env)).to.deep.equal([
      'VIDEO_AGENT_TTS_TOKEN',
      'VIDEO_AGENT_TTS_HEADERS',
    ])
    expect(requirements.find((requirement) => requirement.env === 'VIDEO_AGENT_TTS_TOKEN')?.placeholder).to.equal('<token>')
  })

  it('builds provider env names consistently', () => {
    expect(providerEnvName('vlm', 'URL')).to.equal('VIDEO_AGENT_VLM_URL')
  })
})

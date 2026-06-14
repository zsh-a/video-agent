import {expect} from 'chai'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../packages/runtime/src/config.js'
import {readProviderEnvironment} from '../../../packages/runtime/src/provider-environment.js'

describe('provider environment', () => {
  it('returns no requirements for mock providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      const report = await readProviderEnvironment(root, {})

      expect(report.providers.map((provider) => provider.role)).to.deep.equal(['asr', 'vlm', 'tts'])
      expect(report.providers.flatMap((provider) => provider.requirements)).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('describes command provider requirements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {asr: 'command'})

      const report = await readProviderEnvironment(root, {
        VIDEO_AGENT_ASR_COMMAND: '["node","asr.js"]',
      })
      const asr = report.providers.find((provider) => provider.role === 'asr')

      expect(asr?.requirements).to.deep.equal([
        {
          configured: true,
          description: 'ASR command adapter argv as a JSON string array.',
          env: 'VIDEO_AGENT_ASR_COMMAND',
          required: true,
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('describes http provider requirements without exposing values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {tts: 'http'})

      const report = await readProviderEnvironment(root, {
        VIDEO_AGENT_TTS_TOKEN: 'secret',
        VIDEO_AGENT_TTS_URL: 'https://example.test/tts',
      })
      const tts = report.providers.find((provider) => provider.role === 'tts')

      expect(tts?.requirements).to.deep.equal([
        {
          configured: true,
          description: 'TTS HTTP adapter endpoint.',
          env: 'VIDEO_AGENT_TTS_URL',
          required: true,
        },
        {
          configured: true,
          description: 'TTS bearer token for HTTP adapter requests.',
          env: 'VIDEO_AGENT_TTS_TOKEN',
          required: false,
        },
        {
          configured: false,
          description: 'TTS HTTP adapter timeout in milliseconds.',
          env: 'VIDEO_AGENT_TTS_TIMEOUT_MS',
          required: false,
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

import {expect} from '#test/expect'
import {readJson, writeText} from '#test/fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {MIMO_PROVIDER_MODEL_IDS} from '../../../packages/providers/src/index.js'
import {readConfig, writeConfig} from '../../../packages/runtime/src/config.js'

describe('config', () => {
  it('returns mock defaults before a config file exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const config = await readConfig(root)

      expect(config.providers).to.deep.equal({
        asr: 'mock',
        tts: 'mock',
        vlm: 'mock',
      })
      expect(config.persistence.jobStore).to.equal('json')
      expect(config.pipeline).to.deep.equal({
        maxStageRetries: 0,
        retryBackoffMs: 0,
      })
      expect(config.providerSettings).to.deep.equal({})
      expect(config.llm).to.equal(undefined)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes provider configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config, path} = await writeConfig(root, {asr: 'mock'})

      expect(path).to.contain('config.json')
      expect(config.providers.asr).to.equal('mock')
      expect((await readConfig(root)).providers.asr).to.equal('mock')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('normalizes minimal config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          providers: {
            asr: 'command',
            tts: 'mock',
            vlm: 'mock',
          },
          version: 1,
        })}\n`,
      )

      const config = await readConfig(root)

      expect(config.persistence.jobStore).to.equal('json')
      expect(config.providers.asr).to.equal('command')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes job store configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {jobStore: 'sqlite'})

      expect(config.persistence.jobStore).to.equal('sqlite')
      expect((await readConfig(root)).persistence.jobStore).to.equal('sqlite')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes pipeline retry configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        maxStageRetries: 2,
        retryBackoffMs: 10,
      })

      expect(config.pipeline).to.deep.equal({
        maxStageRetries: 2,
        retryBackoffMs: 10,
      })
      expect((await readConfig(root)).pipeline.maxStageRetries).to.equal(2)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes LLM configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        llm: {
          authTokenEnv: 'VIDEO_AGENT_LLM_TOKEN',
          baseURL: 'https://llm.example.test/anthropic',
          model: 'anthropic-test-model',
        },
        llmProvider: 'anthropic',
      })

      expect(config.llm).to.deep.equal({
        authTokenEnv: 'VIDEO_AGENT_LLM_TOKEN',
        baseURL: 'https://llm.example.test/anthropic',
        model: 'anthropic-test-model',
        provider: 'anthropic',
      })
      expect((await readConfig(root)).llm).to.deep.equal(config.llm)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes command provider configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        asr: 'command',
        tts: 'command',
        vlm: 'command',
      })

      expect(config.providers).to.deep.equal({
        asr: 'command',
        tts: 'command',
        vlm: 'command',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes llm provider configuration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        asr: 'llm',
        tts: 'llm',
        vlm: 'llm',
      })

      expect(config.providers).to.deep.equal({
        asr: 'llm',
        tts: 'llm',
        vlm: 'llm',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes the Mimo hosted provider profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        providerProfile: 'mimo',
      })

      expect(config.providers).to.deep.equal({
        asr: 'llm',
        tts: 'llm',
        vlm: 'llm',
      })
      expect(config.providerProfile).to.equal('mimo')
      expect(config.providerSettings).to.deep.equal({})
      expect(config.llm).to.deep.equal({
        apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
        baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
        model: MIMO_PROVIDER_MODEL_IDS.llm,
        name: 'mimo',
        provider: 'openai-compatible',
      })
      expect(await readJson(join(root, 'config.json'))).to.deep.equal({
        providerProfile: 'mimo',
        version: 1,
      })
      expect((await readConfig(root)).providerSettings).to.deep.equal(config.providerSettings)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

import {expect} from '#test/expect'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeConfig} from '../../../packages/runtime/src/config.js'
import {createProviderEnvironmentShellTemplate, readProviderEnvironment} from '../../../packages/runtime/src/provider-environment.js'

describe('provider environment', () => {
  it('returns no requirements for mock providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      const report = await readProviderEnvironment(root, {})

      expect(report.providers.map((provider) => provider.role)).to.deep.equal(['asr', 'vlm', 'tts'])
      expect(report.providers.flatMap((provider) => provider.requirements)).to.deep.equal([])
      expect(report.summary).to.deep.equal({
        configured: 0,
        missing: 0,
        missingRequired: [],
        optional: 0,
        required: 0,
        total: 0,
      })
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
      expect(report.summary).to.deep.include({
        configured: 1,
        missing: 0,
        optional: 0,
        required: 1,
        total: 1,
      })
      expect(report.summary.missingRequired).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reads command provider values from workspace .env by default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {asr: 'command'})
      await writeFile(join(root, '.env'), 'VIDEO_AGENT_ASR_COMMAND=\'["node","asr.js"]\'\n')

      const report = await readProviderEnvironment(root)
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

  it('does not read .env when explicit env values are provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {asr: 'command'})
      await writeFile(join(root, '.env'), 'VIDEO_AGENT_ASR_COMMAND=\'["node","asr.js"]\'\n')

      const report = await readProviderEnvironment(root, {})
      const asr = report.providers.find((provider) => provider.role === 'asr')

      expect(asr?.requirements).to.deep.equal([
        {
          configured: false,
          description: 'ASR command adapter argv as a JSON string array.',
          env: 'VIDEO_AGENT_ASR_COMMAND',
          required: true,
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns no role-specific requirements for llm providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {tts: 'llm'})

      const report = await readProviderEnvironment(root, {})
      const tts = report.providers.find((provider) => provider.role === 'tts')

      expect(tts?.requirements).to.deep.equal([])
      expect(report.summary).to.deep.equal({
        configured: 0,
        missing: 0,
        missingRequired: [],
        optional: 0,
        required: 0,
        total: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates a shell template without exposing configured values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {
        asr: 'command',
        tts: 'llm',
      })

      const report = await readProviderEnvironment(root, {
        VIDEO_AGENT_ASR_COMMAND: '["node","secret-asr.js"]',
      })
      const template = createProviderEnvironmentShellTemplate(report)

      expect(template).to.include("export VIDEO_AGENT_ASR_COMMAND='[\"bun\",\"./providers/adapter.ts\"]'")
      expect(template).to.not.include('secret')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('does not add optional shell variables for llm providers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {vlm: 'llm'})

      const template = createProviderEnvironmentShellTemplate(await readProviderEnvironment(root, {}), {includeOptional: true})

      expect(template).to.not.include('VIDEO_AGENT_VLM_')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses provider environment defaults from config', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-env-'))

    try {
      await writeConfig(root, {providerProfile: 'mimo'})

      const report = await readProviderEnvironment(root, {})

      expect(report.providers.map((provider) => `${provider.role}:${provider.provider}`)).to.deep.equal(['asr:llm', 'vlm:llm', 'tts:llm'])
      expect(report.summary.missingRequired).to.deep.equal([])
      expect(report.providers.flatMap((provider) => provider.requirements)).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

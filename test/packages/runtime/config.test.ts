import {expect} from '#test/expect'
import {readJson, writeText} from '#test/fs'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {MIMO_PROVIDER_MODEL_IDS} from '../../../packages/providers/src/index.js'
import {readConfig, writeConfig} from '../../../packages/runtime/src/shared/config.js'

describe('config', () => {
  it('rejects reads before a config file exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(Error)
      expect(error instanceof Error ? error.message : '').to.contain('Config file not found')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed config JSON before applying config defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(join(root, 'config.json'), 'not json\n')

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(Error)
      expect(String(error)).to.include('Config file')
      expect(String(error)).to.include('is invalid JSON')
      expect(String(error)).to.include('no config parse fallback is allowed')
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
      expect(await readJson(join(root, 'config.json'))).to.deep.equal({
        providers: {
          asr: 'mock',
          tts: 'mock',
          vlm: 'mock',
        },
        version: 1,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('normalizes explicit config files', async () => {
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

  it('rejects config files without explicit providers or a provider profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('Provider asr must be configured')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects config files without a supported version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('Unsupported config version: undefined')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects unknown provider names while normalizing config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          providers: {
            asr: 'http',
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('Unsupported asr provider: http')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects unknown top-level config fields instead of ignoring legacy shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          legacyProviders: {
            asr: 'mock',
          },
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(String(error)).to.include('no config shape inference fallback is allowed')
      expect(String(error)).to.include('legacyProviders')
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

  it('rejects unknown job store backends while normalizing config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          persistence: {
            jobStore: 'postgres',
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('Unsupported job store: postgres')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed nested config objects instead of applying defaults', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          persistence: 'sqlite',
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(String(error)).to.include('no config shape inference fallback is allowed')
      expect(String(error)).to.include('persistence')
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
          apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
          baseURL: 'https://llm.example.test/anthropic',
          model: 'anthropic-test-model',
        },
        llmProvider: 'anthropic',
      })

      expect(config.llm).to.deep.equal({
        apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
        baseURL: 'https://llm.example.test/anthropic',
        model: 'anthropic-test-model',
        provider: 'anthropic',
      })
      expect((await readConfig(root)).llm).to.deep.equal(config.llm)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects obsolete LLM authTokenEnv config fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          llm: {
            authTokenEnv: 'VIDEO_AGENT_LLM_TOKEN',
            baseURL: 'https://llm.example.test/anthropic',
            model: 'anthropic-test-model',
            provider: 'anthropic',
          },
          version: 1,
        })}\n`,
      )

      let error: unknown

      try {
        await readConfig(root)
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('Unsupported LLM config field: authTokenEnv')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects LLM config fields that would require string cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          llm: {
            baseURL: 'https://llm.example.test/anthropic',
            model: ' anthropic-test-model ',
            provider: 'anthropic',
          },
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(String(error)).to.include('LLM model must be clean non-empty text')
      expect(String(error)).to.include('no config string cleanup fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects LLM headers that would be filtered during config normalization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          llm: {
            baseURL: 'https://llm.example.test/anthropic',
            headers: {
              ' X-Test': 'value',
            },
            model: 'anthropic-test-model',
            provider: 'anthropic',
          },
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(String(error)).to.include('no config header cleanup fallback is allowed')
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

  it('rejects unknown provider settings roles while normalizing config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          providerSettings: {
            storyboard: {
              command: ['bun', 'providers/storyboard.ts'],
            },
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('Unsupported provider settings role: storyboard')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects unknown provider settings fields while normalizing config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          providerSettings: {
            asr: {
              endpoint: 'https://provider.example.test/asr',
            },
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('Unsupported provider settings field for asr: endpoint')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects invalid provider settings command arrays while normalizing config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          providers: {
            asr: 'mock',
            tts: 'mock',
            vlm: 'mock',
          },
          providerSettings: {
            asr: {
              command: ['bun', ' providers/asr.ts '],
            },
          },
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('no command argv cleanup fallback is allowed')
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

  it('stores only explicit provider overrides for hosted profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      const {config} = await writeConfig(root, {
        asr: 'command',
        providerProfile: 'mimo',
      })

      expect(config.providers).to.deep.equal({
        asr: 'command',
        tts: 'llm',
        vlm: 'llm',
      })
      expect(await readJson(join(root, 'config.json'))).to.deep.equal({
        providerProfile: 'mimo',
        providers: {
          asr: 'command',
        },
        version: 1,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects unknown provider profiles while normalizing config files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-config-'))

    try {
      await writeText(
        join(root, 'config.json'),
        `${JSON.stringify({
          providerProfile: 'hosted-service',
          version: 1,
        })}\n`,
      )

      const error = await captureAsyncError(() => readConfig(root))

      expect(error).to.be.instanceOf(TypeError)
      expect(error instanceof Error ? error.message : '').to.contain('Unsupported provider profile: hosted-service')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function captureAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }

  throw new Error('Expected function to throw.')
}

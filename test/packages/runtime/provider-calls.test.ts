import {expect} from '#test/expect'
import {readJsonLines} from '#test/fs'
import {attachProviderMetadata, ProviderExecutionError, type ProviderSet, type ScriptProvider} from '@video-agent/providers'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createJsonlProviderCallRecorder, instrumentProviders, instrumentScriptProvider} from '../../../packages/runtime/src/provider/calls.js'

describe('provider call recorder', () => {
  it('records provider request metadata on successful calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-calls-'))
    const path = join(root, 'provider-calls.jsonl')
    const providers = instrumentProviders(
      createProviderSet({
        asr: {
          async transcribe() {
            return attachProviderMetadata(
              {
                segments: [],
                text: 'hello',
              },
              {
                cost: {
                  amount: 0.02,
                  currency: 'USD',
                },
                model: 'asr-test',
                requestId: 'req-asr-1',
                usage: {
                  inputCharacters: 5,
                  outputCharacters: 5,
                },
              },
            )
          },
        },
        tts: {
          async synthesize() {
            return []
          },
        },
        vlm: {
          async analyzeScenes() {
            return []
          },
        },
      }),
      {
        asr: 'test-asr',
        tts: 'test-tts',
        vlm: 'test-vlm',
      },
      createJsonlProviderCallRecorder(path),
    )

    try {
      await providers.asr.transcribe({path: '/tmp/audio.wav'})

      const [call] = await readJsonLines<Record<string, unknown>>(path)

      expect(call.requestId).to.equal('req-asr-1')
      expect(call.model).to.equal('asr-test')
      expect(call.cost).to.deep.equal({
        amount: 0.02,
        currency: 'USD',
      })
      expect(call.usage).to.deep.equal({
        inputCharacters: 5,
        outputCharacters: 5,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('records failed provider calls before rethrowing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-calls-'))
    const path = join(root, 'provider-calls.jsonl')
    const providers = instrumentProviders(
      createProviderSet({
        asr: {
          async transcribe() {
            throw new Error('asr failed')
          },
        },
        tts: {
          async synthesize() {
            return []
          },
        },
        vlm: {
          async analyzeScenes() {
            return []
          },
        },
      }),
      {
        asr: 'test-asr',
        tts: 'test-tts',
        vlm: 'test-vlm',
      },
      createJsonlProviderCallRecorder(path),
    )

    try {
      await providers.asr.transcribe({path: '/tmp/audio.wav'})
      expect.fail('Expected ASR provider to throw.')
    } catch (error) {
      expect(error).to.be.instanceOf(Error)
    } finally {
      const [call] = await readJsonLines<Record<string, unknown>>(path)

      expect(call.status).to.equal('failed')
      expect(call.role).to.equal('asr')
      expect(call.provider).to.equal('test-asr')
      expect(call.requestId).to.be.a('string')
      expect(call.error).to.deep.equal({
        message: 'asr failed',
        name: 'Error',
      })
      await rm(root, {force: true, recursive: true})
    }
  })

  it('records structured retryable provider errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-calls-'))
    const path = join(root, 'provider-calls.jsonl')
    const providers = instrumentProviders(
      createProviderSet({
        asr: {
          async transcribe() {
            throw new ProviderExecutionError({
              code: 'command_exit',
              details: {
                exitCode: 124,
              },
              message: 'Provider command failed with exit code 124.',
              retryable: true,
              role: 'asr',
            })
          },
        },
        tts: {
          async synthesize() {
            return []
          },
        },
        vlm: {
          async analyzeScenes() {
            return []
          },
        },
      }),
      {
        asr: 'command',
        tts: 'test-tts',
        vlm: 'test-vlm',
      },
      createJsonlProviderCallRecorder(path),
    )

    try {
      await providers.asr.transcribe({path: '/tmp/audio.wav'})
      expect.fail('Expected ASR provider to throw.')
    } catch (error) {
      expect(error).to.be.instanceOf(ProviderExecutionError)
    } finally {
      const [call] = await readJsonLines<Record<string, unknown>>(path)

      expect(call.error).to.deep.equal({
        code: 'command_exit',
        details: {
          exitCode: 124,
        },
        message: 'Provider command failed with exit code 124.',
        name: 'ProviderExecutionError',
        retryable: true,
      })
      await rm(root, {force: true, recursive: true})
    }
  })

  it('records script provider calls separately from media provider sets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-provider-calls-'))
    const path = join(root, 'provider-calls.jsonl')
    const provider = instrumentScriptProvider(createScriptProvider(), createJsonlProviderCallRecorder(path))

    try {
      await provider.createStoryIndex({
        asrResult: {
          language: 'en',
          segments: [],
          text: '',
          timestampConfidence: 'exact',
          version: 1,
        },
        language: 'en',
        sourceManifest: {
          audioTracks: 1,
          duration: 10,
          orientation: 'landscape',
          sourceHash: 'hash',
          sourcePath: '/tmp/input.mp4',
          version: 1,
        },
        timelineFusion: {
          items: [],
          source: 'timeline-fusion',
          version: 1,
        },
        vlmAnalysis: {
          scenes: [],
          source: 'vlm',
          version: 1,
        },
      })

      const [call] = await readJsonLines<Record<string, unknown>>(path)

      expect(call.role).to.equal('script')
      expect(call.provider).to.equal('script')
      expect(call.operation).to.equal('createStoryIndex')
      expect(call.status).to.equal('succeeded')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

function createProviderSet(providers: Pick<ProviderSet, 'asr' | 'tts' | 'vlm'>): ProviderSet {
  return providers
}

function createScriptProvider(): ScriptProvider {
  return {
    async createRecapScript() {
      throw new Error('Recap script is not used by this test.')
    },
    async createStoryIndex() {
      return {
        characterIndex: {
          characters: [],
          source: 'script',
          version: 1,
        },
        narrativeBeats: {
          beats: [],
          source: 'script',
          version: 1,
        },
        storyIndex: {
          beats: [],
          characters: [],
          language: 'en',
          source: 'script',
          sourceDuration: 10,
          version: 1,
        },
      }
    },
  }
}

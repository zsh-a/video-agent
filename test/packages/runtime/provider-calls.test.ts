import {expect} from '#test/expect'
import {attachProviderMetadata, type ProviderSet} from '@video-agent/providers'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createJsonlProviderCallRecorder, instrumentProviders} from '../../../packages/runtime/src/provider-calls.js'

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

      const [call] = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)

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
      const [call] = (await readFile(path, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)

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
})

function createProviderSet(providers: Pick<ProviderSet, 'asr' | 'tts' | 'vlm'>): ProviderSet {
  return {
    ...providers,
    script: {
      async createNarration() {
        throw new Error('Script provider is not used by this test.')
      },
    },
    storyboard: {
      async createStoryboard() {
        throw new Error('Storyboard provider is not used by this test.')
      },
    },
  }
}

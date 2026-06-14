import {expect} from 'chai'

import type {ProviderFetch} from '../../../packages/providers/src/index.js'

import {createMockHttpProviderEnvelope} from '../../../examples/provider-adapters/mock-http-provider.js'
import {HttpASRProvider, HttpTTSProvider, HttpVLMProvider, readProviderMetadata} from '../../../packages/providers/src/index.js'

describe('http providers', () => {
  it('runs ASR over HTTP JSON payloads and preserves metadata', async () => {
    const provider = new HttpASRProvider({
      fetch: jsonFetch((payload, init) => {
        expect(payload).to.include({
          kind: 'asr',
          version: 1,
        })
        expect(init.headers).to.include({
          'content-type': 'application/json',
          'x-video-agent-kind': 'asr',
          'x-video-agent-version': '1',
        })
        expect(init.headers['x-video-agent-request-id']).to.match(/^http_/)

        return {
          data: {
            segments: [
              {
                end: 1,
                start: 0,
                text: 'http transcript',
              },
            ],
            text: 'http transcript',
          },
          metadata: {
            model: 'http-asr',
            requestId: 'req-http-asr',
          },
        }
      }),
      url: 'https://provider.test/asr',
    })

    const transcript = await provider.transcribe({path: '/tmp/audio.wav'})

    expect(transcript.text).to.equal('http transcript')
    expect(readProviderMetadata(transcript)).to.deep.equal({
      model: 'http-asr',
      requestId: 'req-http-asr',
    })
  })

  it('runs VLM and TTS over HTTP JSON payloads', async () => {
    const scenes = await new HttpVLMProvider({
      fetch: jsonFetch(() => [
        {
          description: 'scene',
          evidence: ['frame.jpg'],
          sceneId: 'scene-1',
        },
      ]),
      url: 'https://provider.test/vlm',
    }).analyzeScenes([{frames: ['frame.jpg'], sceneId: 'scene-1', timeRange: [0, 1]}])
    const segments = await new HttpTTSProvider({
      fetch: jsonFetch(() => [
        {
          duration: 1,
          narrationId: 'narration-1',
          path: 'tts/narration-1.wav',
        },
      ]),
      url: 'https://provider.test/tts',
    }).synthesize([{duration: 1, id: 'narration-1', text: 'hello'}])

    expect(scenes[0].sceneId).to.equal('scene-1')
    expect(segments[0].path).to.equal('tts/narration-1.wav')
    expect(readProviderMetadata(scenes)?.requestId).to.match(/^http_/)
    expect(readProviderMetadata(segments)?.requestId).to.match(/^http_/)
  })

  it('runs the documented HTTP adapter recipe', async () => {
    const fetch = mockHttpRecipeFetch()
    const transcript = await new HttpASRProvider({
      fetch,
      timeoutMs: 5000,
      url: 'http://127.0.0.1:4318',
    }).transcribe({path: '/tmp/audio.wav'})
    const scenes = await new HttpVLMProvider({
      fetch,
      timeoutMs: 5000,
      url: 'http://127.0.0.1:4318',
    }).analyzeScenes([{frames: ['frame.jpg'], sceneId: 'scene-1', timeRange: [0, 1]}])
    const segments = await new HttpTTSProvider({
      fetch,
      timeoutMs: 5000,
      url: 'http://127.0.0.1:4318',
    }).synthesize([{duration: 1, id: 'narration-1', text: 'hello'}])

    expect(transcript.text).to.equal('Example transcript for /tmp/audio.wav')
    expect(scenes[0]).to.deep.equal({
      description: 'Example visual analysis for scene-1',
      evidence: ['frame.jpg'],
      sceneId: 'scene-1',
    })
    expect(segments[0]).to.deep.equal({
      duration: 1,
      narrationId: 'narration-1',
      path: 'tts/narration-1.wav',
    })
    expect(readProviderMetadata(transcript)).to.include({
      model: 'example-http-provider',
    })
    expect(readProviderMetadata(transcript)?.requestId).to.match(/^http_/)
  })
})

function jsonFetch(handler: (payload: Record<string, unknown>, init: Parameters<ProviderFetch>[1]) => unknown): ProviderFetch {
  return async (_url, init) => {
    const result = handler(JSON.parse(init.body) as Record<string, unknown>, init)

    return {
      async json() {
        return result
      },
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(result)
      },
    }
  }
}

function mockHttpRecipeFetch(): ProviderFetch {
  return async (_url, init) => {
    const result = createMockHttpProviderEnvelope(JSON.parse(init.body) as Record<string, unknown>, init.headers)

    return {
      async json() {
        return result
      },
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(result)
      },
    }
  }
}

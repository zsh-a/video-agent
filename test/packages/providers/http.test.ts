import {expect} from 'chai'

import type {ProviderFetch} from '../../../packages/providers/src/index.js'

import {HttpASRProvider, HttpTTSProvider, HttpVLMProvider, readProviderMetadata} from '../../../packages/providers/src/index.js'

describe('http providers', () => {
  it('runs ASR over HTTP JSON payloads and preserves metadata', async () => {
    const provider = new HttpASRProvider({
      fetch: jsonFetch((payload) => {
        expect(payload).to.include({
          kind: 'asr',
          version: 1,
        })

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
  })
})

function jsonFetch(handler: (payload: Record<string, unknown>) => unknown): ProviderFetch {
  return async (_url, init) => {
    const result = handler(JSON.parse(init.body) as Record<string, unknown>)

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

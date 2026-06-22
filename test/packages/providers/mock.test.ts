import {expect} from '#test/expect'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {MockTTSProvider} from '../../../packages/providers/src/index.js'

describe('mock providers', () => {
  it('writes mock TTS wav files when an output directory is provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mock-tts-'))

    try {
      const provider = new MockTTSProvider()
      const segments = await provider.synthesize(
        [{duration: 0.2, id: 'narration-1', text: 'hello'}],
        {
          outputDir: join(root, 'tts'),
          pathPrefix: 'audio/tts',
        },
      )

      expect(segments).to.deep.equal([
        {
          duration: 0.2,
          narrationId: 'narration-1',
          path: 'audio/tts/0001-narration-1.wav',
        },
      ])
      expect((await readFile(join(root, 'tts', '0001-narration-1.wav'))).subarray(0, 4).toString('ascii')).to.equal('RIFF')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects invalid mock TTS durations instead of writing synthetic minimum audio', async () => {
    const provider = new MockTTSProvider()
    let error: unknown

    try {
      await provider.synthesize([{duration: Number.NaN, id: 'narration-1', text: 'hello'}])
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('Mock TTS segment "narration-1" must include a positive finite duration; no synthetic mock audio duration fallback is allowed. Received: NaN')
  })

  it('rejects mock TTS durations that cannot produce a WAV frame', async () => {
    const provider = new MockTTSProvider()
    let error: unknown

    try {
      await provider.synthesize([{duration: 0.000001, id: 'narration-1', text: 'hello'}])
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('no single-frame mock audio fallback is allowed')
  })
})

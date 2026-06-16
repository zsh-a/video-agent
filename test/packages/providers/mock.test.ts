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
        [{duration: 0.2, id: 'narration-1', start: 0, text: 'hello'}],
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
})

import {expect} from '#test/expect'

import type {Narration} from '../../../packages/ir/src/index.js'

import {alignFilmTtsSegmentsToNarration, createAudioMixVoiceovers} from '../../../packages/pipeline-film/src/render/audio.js'

const narration: Narration = {
  language: 'en-US',
  segments: [
    {
      duration: 3,
      id: 'narration-1',
      sceneId: 'scene-1',
      start: 0,
      text: 'A narration segment.',
    },
  ],
  version: 1,
}

describe('film audio alignment', () => {
  it('rejects TTS duration alignment when narrationId does not match', async () => {
    let error: unknown

    try {
      await alignFilmTtsSegmentsToNarration('/tmp/video-agent', narration, [
        {
          duration: 2,
          narrationId: 'unknown-narration',
          path: 'audio/tts/unknown.wav',
        },
      ])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('unknown narrationId "unknown-narration"')
  })

  it('rejects non-positive TTS duration during alignment instead of keeping provider output', async () => {
    let error: unknown

    try {
      await alignFilmTtsSegmentsToNarration('/tmp/video-agent', narration, [
        {
          duration: 0,
          narrationId: 'narration-1',
          path: 'audio/tts/narration-1.wav',
        },
      ])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('positive duration for TTS alignment')
  })

  it('rejects audio mix voiceovers when narrationId does not match', async () => {
    let error: unknown

    try {
      await createAudioMixVoiceovers('/tmp/video-agent', narration, [
        {
          duration: 2,
          narrationId: 'unknown-narration',
          path: 'audio/tts/unknown.wav',
        },
      ])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('unknown narrationId "unknown-narration"')
  })

  it('rejects non-positive TTS duration during audio mixing instead of using narration duration', async () => {
    let error: unknown

    try {
      await createAudioMixVoiceovers('/tmp/video-agent', narration, [
        {
          duration: 0,
          narrationId: 'narration-1',
          path: 'audio/tts/narration-1.wav',
        },
      ])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('no narration-duration fallback')
  })
})

import {expect} from '#test/expect'

import type {OutputNarration} from '../../../packages/ir/src/index.js'

import {alignFilmTtsSegmentsToOutputNarration, createAudioMixVoiceovers, renderAudioMix} from '../../../packages/pipeline-film/src/render/audio.js'
import {checkFilmTtsDurationBounds, readFilmAudioMix, readFilmSubtitles} from '../../../packages/pipeline-film/src/render/quality.js'

const outputNarration: OutputNarration = {
  language: 'en-US',
  segments: [
    {
      end: 3,
      evidence: ['scene-1'],
      id: 'narration-1',
      overlapsSpeech: false,
      pauseAfterMs: 0,
      source: 'script',
      start: 0,
      text: 'A narration segment.',
    },
  ],
  timeline: 'output',
  version: 1,
}

describe('film audio alignment', () => {
  it('rejects TTS duration alignment when narrationId does not match', async () => {
    let error: unknown

    try {
      await alignFilmTtsSegmentsToOutputNarration('/tmp/video-agent', outputNarration, [
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
      await alignFilmTtsSegmentsToOutputNarration('/tmp/video-agent', outputNarration, [
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

  it('rejects invalid narration timing during alignment instead of conforming with NaN duration', async () => {
    let error: unknown

    try {
      await alignFilmTtsSegmentsToOutputNarration('/tmp/video-agent', createOutputNarration({
        end: Number.NaN,
        start: 0,
      }), [
        {
          duration: 2,
          narrationId: 'narration-1',
          path: 'audio/tts/narration-1.wav',
        },
      ])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('no audio timing clamp fallback is allowed')
  })

  it('rejects audio mix voiceovers when narrationId does not match', async () => {
    let error: unknown

    try {
      await createAudioMixVoiceovers('/tmp/video-agent', outputNarration, [
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
      await createAudioMixVoiceovers('/tmp/video-agent', outputNarration, [
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

  it('rejects negative narration starts during audio mixing instead of clamping delay to zero', async () => {
    let error: unknown

    try {
      await createAudioMixVoiceovers('/tmp/video-agent', createOutputNarration({
        end: 2,
        start: -0.25,
      }), [
        {
          duration: 1,
          narrationId: 'narration-1',
          path: 'audio/tts/narration-1.wav',
        },
      ])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('finite non-negative start for audio mixing')
  })

  it('rejects non-positive audio mix duration instead of rendering synthetic minimum silence', async () => {
    let error: unknown

    try {
      await renderAudioMix('/tmp/video-agent-invalid-audio-mix.wav', 0, undefined, [])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('no synthetic minimum audio duration fallback is allowed')
  })

  it('reports invalid TTS duration during render quality instead of clamping to zero', () => {
    const issues = checkFilmTtsDurationBounds(outputNarration, [
      {
        duration: -1,
        narrationId: 'narration-1',
        path: 'audio/tts/narration-1.wav',
      },
    ], 3)

    expect(issues).to.deep.equal([
      {
        code: 'tts.segment.invalid_duration',
        message: 'TTS audio for narration narration-1 has invalid duration; no zero-duration TTS quality fallback is allowed.',
        severity: 'error',
      },
    ])
  })

  it('rejects schema-invalid audio mix artifacts instead of trusting stored JSON shape', async () => {
    let error: unknown

    try {
      await readFilmAudioMix(Promise.resolve({
        duration: -1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        loudnessNormalization: {
          loudnessRangeLufs: 11,
          targetIntegratedLufs: -16,
          truePeakDb: -1,
        },
        mode: 'voiceover-only',
        outputPath: 'audio/final.wav',
        sourceAudioRetained: false,
        sourcePath: 'source.mp4',
        sourceVolume: 1,
        version: 1,
        voiceoverSegments: [],
        voiceoverVolume: 1,
      }))
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('duration')
  })

  it('rejects schema-invalid subtitle artifacts instead of trusting stored JSON shape', async () => {
    let error: unknown

    try {
      await readFilmSubtitles(Promise.resolve({
        cues: -1,
        format: 'srt',
        generatedAt: '2026-01-01T00:00:00.000Z',
        path: 'subtitles/final.srt',
        version: 1,
      }))
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('cues')
  })
})

function createOutputNarration(timing: {end: number; start: number}): OutputNarration {
  return {
    ...outputNarration,
    segments: [
      {
        ...outputNarration.segments[0]!,
        end: timing.end,
        start: timing.start,
      },
    ],
  }
}

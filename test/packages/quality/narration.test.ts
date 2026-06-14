import {expect} from 'chai'

import type {Narration, Timeline} from '../../../packages/ir/src/index.js'

import {checkNarrationTiming, checkTtsCoverage} from '../../../packages/quality/src/index.js'

describe('narration quality', () => {
  it('reports narration timing issues', () => {
    const narration: Narration = {
      language: 'zh-CN',
      segments: [
        {
          duration: 1,
          id: 'narration-1',
          start: 0,
          text: 'first',
        },
        {
          duration: 1,
          id: 'narration-2',
          start: 0.5,
          text: 'second',
        },
        {
          duration: 1,
          id: 'narration-3',
          start: 2.5,
          text: 'third',
        },
        {
          id: 'narration-4',
          text: 'fourth',
        },
      ],
      version: 1,
    }
    const timeline = createTimeline(3)

    expect(checkNarrationTiming(narration, timeline).map((issue) => issue.code)).to.deep.equal([
      'narration.segment.out_of_bounds',
      'narration.segment.missing_start',
      'narration.segment.missing_duration',
      'narration.segment.overlap',
    ])
  })

  it('reports TTS coverage and duration issues', () => {
    const narration: Narration = {
      language: 'zh-CN',
      segments: [
        {
          duration: 1,
          id: 'narration-1',
          start: 0,
          text: 'first',
        },
        {
          duration: 1,
          id: 'narration-2',
          start: 1,
          text: 'second',
        },
      ],
      version: 1,
    }

    expect(
      checkTtsCoverage(narration, [
        {
          duration: 0.2,
          narrationId: 'narration-1',
          path: 'tts/short.wav',
        },
        {
          duration: 0,
          narrationId: 'unknown',
          path: '',
        },
      ]).map((issue) => issue.code),
    ).to.deep.equal([
      'tts.segment.unknown_narration',
      'tts.segment.invalid_duration',
      'tts.segment.missing_path',
      'tts.duration.mismatch',
      'tts.segment.missing',
    ])
  })
})

function createTimeline(duration: number): Timeline {
  return {
    duration,
    fps: 30,
    items: [],
    version: 1,
  }
}

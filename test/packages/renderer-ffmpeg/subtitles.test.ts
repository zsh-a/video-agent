import {expect} from '#test/expect'

import {narrationToSrt} from '../../../packages/renderer-ffmpeg/src/subtitles.js'

describe('ffmpeg subtitles', () => {
  it('formats narration as srt cues', () => {
    const srt = narrationToSrt({
      language: 'zh-CN',
      segments: [
        {
          duration: 1.5,
          id: 'narration-1',
          start: 0.25,
          text: 'hello',
        },
      ],
      version: 1,
    })

    expect(srt).to.equal('1\n00:00:00,250 --> 00:00:01,750\nhello\n')
  })
})

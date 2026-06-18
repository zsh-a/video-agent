import {expect} from '#test/expect'

import {narrationToSrt, narrationToSrtCues} from '../../../packages/renderer-ffmpeg/src/subtitles.js'

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

  it('splits long narration text into shorter timed subtitle cues', () => {
    const narration = {
      language: 'zh-CN',
      segments: [
        {
          duration: 12,
          id: 'narration-1',
          start: 3,
          text: '第一句交代背景，第二句继续推进剧情。第三句把冲突抛出来，第四句给出结果。',
        },
      ],
      version: 1 as const,
    }
    const cues = narrationToSrtCues(narration)
    const srt = narrationToSrt(narration)

    expect(cues.length).to.be.greaterThan(1)
    expect(cues[0]).to.deep.include({
      index: 1,
      start: 3,
    })
    expect(cues.at(-1)?.end).to.equal(15)
    expect(srt).to.contain('\n2\n')
    expect(srt).to.contain('\n')
  })
})

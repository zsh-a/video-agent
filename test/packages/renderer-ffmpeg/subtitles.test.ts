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

  it('does not insert arbitrary line breaks inside CJK subtitle text', () => {
    const cues = narrationToSrtCues({
      language: 'zh-CN',
      segments: [
        {
          duration: 4,
          id: 'narration-1',
          start: 0,
          text: '我们到底在谈论什么需求以及如何验证这些需求',
        },
      ],
      version: 1,
    })

    expect(cues).to.have.length(1)
    expect(cues[0]?.text).to.equal('我们到底在谈论什么需求以及如何验证这些需求')
  })

  it('keeps CJK words and numeric ranges intact while splitting cues', () => {
    const cues = narrationToSrtCues({
      language: 'zh-CN',
      segments: [
        {
          duration: 8,
          id: 'narration-1',
          start: 0,
          text: '我们寻找的是用户付费、企业采购、供应商出货、产能排满等可验证的需求信号。我们必须把投资论点拆解成未来1-4个季度可以观察到的具体指标。',
        },
      ],
      version: 1,
    })
    const cueText = cues.map((cue) => cue.text).join('\n')

    expect(cueText).to.contain('需求信号')
    expect(cueText).to.contain('1-4个季度')
    expect(cueText.includes('需\n求')).to.equal(false)
    expect(cueText.includes('1-\n4')).to.equal(false)
  })
})

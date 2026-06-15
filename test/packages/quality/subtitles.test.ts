import {expect} from '#test/expect'

import {checkSrtSubtitles, parseSrt} from '../../../packages/quality/src/index.js'

describe('subtitle quality', () => {
  it('parses srt cues', () => {
    expect(
      parseSrt(`1
00:00:00,000 --> 00:00:01,000
hello

2
00:00:01,000 --> 00:00:02,500
world
`),
    ).to.deep.equal([
      {
        end: 1,
        index: 1,
        start: 0,
        text: 'hello',
      },
      {
        end: 2.5,
        index: 2,
        start: 1,
        text: 'world',
      },
    ])
  })

  it('reports subtitle cue timing and count issues', () => {
    const result = checkSrtSubtitles(
      `1
00:00:00,000 --> 00:00:01,000
hello

2
00:00:00,900 --> 00:00:00,800

3
00:00:01,000 --> 00:00:03,000
late
`,
      {
        expectedCues: 2,
        maxEnd: 2,
      },
    )

    expect(result.cues).to.equal(3)
    expect(result.errors).to.equal(2)
    expect(result.warnings).to.equal(3)
    expect(result.issues.map((issue) => issue.code)).to.deep.equal([
      'subtitle.cue_count.mismatch',
      'subtitle.cue.non_positive_duration',
      'subtitle.cue.overlap',
      'subtitle.cue.out_of_bounds',
      'subtitle.cue.empty_text',
    ])
  })
})

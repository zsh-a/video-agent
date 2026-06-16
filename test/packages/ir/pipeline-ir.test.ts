import {expect} from '#test/expect'

import {
  ClaimsSchema,
  DeckSchema,
  OutputNarrationSchema,
  OutputTimelineMapSchema,
  SourceQuotesSchema,
  StoryIndexSchema,
  TimedDeckSchema,
} from '../../../packages/ir/src/index.js'

describe('pipeline-specific IR schemas', () => {
  it('validates deck explainer IR for generated and audio-anchored modes', () => {
    const deck = DeckSchema.parse({
      inputMode: 'audio-anchored',
      slides: [
        {
          slideId: 's001',
          title: 'Agent runtime',
          type: 'title',
          visual: {
            kind: 'title-card',
          },
        },
      ],
      title: 'Video agent architecture',
      version: 1,
    })

    expect(deck).to.include({
      format: 'portrait_1080x1920',
      inputMode: 'audio-anchored',
      language: 'zh-CN',
      theme: 'default',
    })

    const timedDeck = TimedDeckSchema.parse({
      audioRef: 'audio/original.wav',
      deck,
      timings: [
        {
          end: 12.2,
          slideId: 's001',
          start: 0,
        },
      ],
      version: 1,
    })

    expect(timedDeck.timings[0]).to.deep.equal({
      end: 12.2,
      slideId: 's001',
      start: 0,
    })

    const claims = ClaimsSchema.parse({
      claims: [
        {
          blockId: 'block-001',
          evidence: [{ref: 'document.json#block-001', text: 'Agent runtime', type: 'research'}],
          id: 'claim-001',
          text: 'Agent runtime owns orchestration.',
          type: 'claim',
        },
      ],
      version: 1,
    })
    const sourceQuotes = SourceQuotesSchema.parse({
      quotes: [
        {
          blockId: 'block-001',
          id: 'quote-001',
          sourceRange: [0, 32],
          text: 'Agent runtime owns orchestration.',
        },
      ],
      version: 1,
    })

    expect(claims.claims[0]).to.deep.include({
      blockId: 'block-001',
      confidence: 0.7,
      id: 'claim-001',
      type: 'claim',
    })
    expect(sourceQuotes.quotes[0]?.sourceRange).to.deep.equal([0, 32])
  })

  it('rejects slide timings that do not reference the deck', () => {
    let error: unknown

    try {
      TimedDeckSchema.parse({
        deck: {
          slides: [
            {
              slideId: 's001',
              title: 'Only slide',
              type: 'title',
            },
          ],
          title: 'Deck',
          version: 1,
        },
        timings: [
          {
            end: 3,
            slideId: 'missing',
            start: 0,
          },
        ],
        version: 1,
      })
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
  })

  it('validates film story index and output-timeline narration', () => {
    const storyIndex = StoryIndexSchema.parse({
      beats: [
        {
          evidence: [
            {
              ref: 'asr_result.json#12',
              type: 'asr',
            },
          ],
          id: 'beat_001',
          sourceRange: [120, 260],
          summary: 'The protagonist finds the clue that escalates the conflict.',
          type: 'inciting_incident',
        },
      ],
      source: 'input.mp4',
      sourceDuration: 5420.3,
      version: 1,
    })

    expect(storyIndex.beats[0]).to.include({
      id: 'beat_001',
      type: 'inciting_incident',
    })

    const timelineMap = OutputTimelineMapSchema.parse({
      clips: [
        {
          clipId: 'clip_000',
          outputEnd: 58,
          outputStart: 0,
          sourceEnd: 178,
          sourceStart: 120,
        },
      ],
      outputDuration: 58,
      source: 'edited_source.mp4',
      version: 1,
    })

    expect(timelineMap.clips[0]).to.deep.equal({
      clipId: 'clip_000',
      outputEnd: 58,
      outputStart: 0,
      sourceEnd: 178,
      sourceStart: 120,
    })

    const narration = OutputNarrationSchema.parse({
      segments: [
        {
          end: 5.8,
          evidence: ['beat_001', 'clip_000'],
          id: 'n001',
          overlapsSpeech: true,
          start: 1.2,
          text: 'The story opens with what looks like a routine assignment.',
        },
      ],
      timeline: 'output',
      version: 1,
    })

    expect(narration).to.include({
      language: 'zh-CN',
      timeline: 'output',
    })
  })

  it('rejects film output timeline maps outside the rendered duration', () => {
    let error: unknown

    try {
      OutputTimelineMapSchema.parse({
        clips: [
          {
            clipId: 'clip_000',
            outputEnd: 12,
            outputStart: 0,
            sourceEnd: 12,
            sourceStart: 0,
          },
        ],
        outputDuration: 10,
        source: 'edited_source.mp4',
        version: 1,
      })
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
  })
})

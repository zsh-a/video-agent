import {expect} from '#test/expect'

import {
  ClaimsSchema,
  ContentBlocksSchema,
  DeckSchema,
  MotionTimelineSchema,
  OutputNarrationSchema,
  OutputTimelineMapSchema,
  SourceQuotesSchema,
  StoryIndexSchema,
  TimedDeckSchema,
} from '../../../packages/ir/src/index.js'

describe('pipeline-specific IR schemas', () => {
  it('validates deck explainer IR for generated and audio-anchored modes', () => {
    const deck = DeckSchema.parse({
      format: 'portrait_1080x1920',
      inputMode: 'audio-anchored',
      language: 'en-US',
      slides: [
        {
          blockIds: ['block-001'],
          evidence: [{ref: 'document.json#block-001', text: 'Agent runtime', type: 'research'}],
          motion: 'cinematic-rise',
          points: ['Core only emits events', 'Adapters render events'],
          slideId: 's001',
          title: 'Agent runtime',
          type: 'hero',
          visual: {
            assetRefs: [],
            kind: 'title-card',
          },
        },
      ],
      theme: 'elegant-dark',
      title: 'Video agent architecture',
      version: 1,
    })

    expect(deck).to.include({
      format: 'portrait_1080x1920',
      inputMode: 'audio-anchored',
      language: 'en-US',
      theme: 'elegant-dark',
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
          confidence: 0.82,
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
          evidence: [{ref: 'document.json#block-001', text: 'Agent runtime', type: 'research'}],
          id: 'quote-001',
          sourceRange: [0, 32],
          text: 'Agent runtime owns orchestration.',
        },
      ],
      version: 1,
    })

    expect(claims.claims[0]).to.deep.include({
      blockId: 'block-001',
      confidence: 0.82,
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
          format: 'portrait_1080x1920',
          inputMode: 'script-generated',
          language: 'en-US',
          slides: [
            {
              blockIds: [],
              evidence: [],
              motion: 'fade-in',
              points: [],
              slideId: 's001',
              title: 'Only slide',
              type: 'hero',
              visual: {assetRefs: [], kind: 'title-card'},
            },
          ],
          theme: 'elegant-dark',
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

  it('requires generated deck content fields instead of applying semantic defaults', () => {
    expect(() => DeckSchema.parse({
      format: 'portrait_1080x1920',
      inputMode: 'script-generated',
      language: 'en-US',
      slides: [
        {
          blockIds: [],
          evidence: [],
          points: [],
          slideId: 's001',
          title: 'Missing motion',
          type: 'hero',
        },
      ],
      theme: 'elegant-dark',
      title: 'Deck',
      version: 1,
    })).to.throw('motion')

    expect(() => DeckSchema.parse({
      format: 'portrait_1080x1920',
      inputMode: 'script-generated',
      language: 'en-US',
      slides: [
        {
          blockIds: [],
          evidence: [],
          motion: 'fade-in',
          points: [],
          slideId: 's001',
          title: 'Missing theme',
          type: 'hero',
        },
      ],
      title: 'Deck',
      version: 1,
    })).to.throw('theme')

    expect(() => DeckSchema.parse({
      format: 'portrait_1080x1920',
      inputMode: 'script-generated',
      language: 'en-US',
      slides: [
        {
          blockIds: [],
          evidence: [],
          motion: 'fade-in',
          slideId: 's001',
          title: 'Missing points',
          type: 'hero',
        },
      ],
      theme: 'elegant-dark',
      title: 'Deck',
      version: 1,
    })).to.throw('points')

    expect(() => DeckSchema.parse({
      inputMode: 'script-generated',
      language: 'en-US',
      slides: [
        {
          blockIds: [],
          evidence: [],
          motion: 'fade-in',
          points: [],
          slideId: 's001',
          title: 'Missing format',
          type: 'hero',
        },
      ],
      theme: 'elegant-dark',
      title: 'Deck',
      version: 1,
    })).to.throw('format')

    expect(() => DeckSchema.parse({
      format: 'portrait_1080x1920',
      inputMode: 'script-generated',
      language: 'en-US',
      slides: [
        {
          evidence: [],
          motion: 'fade-in',
          points: [],
          slideId: 's001',
          title: 'Missing blockIds',
          type: 'hero',
        },
      ],
      theme: 'elegant-dark',
      title: 'Deck',
      version: 1,
    })).to.throw('blockIds')
  })

  it('requires Deck content artifacts to carry LLM-authored source ranges', () => {
    expect(() => ContentBlocksSchema.parse({
      blocks: [
        {
          evidence: [{ref: 'document.json#block-001', text: 'Agent runtime', type: 'research'}],
          id: 'block-001',
          text: 'Agent runtime owns orchestration.',
          type: 'claim',
        },
      ],
      version: 1,
    })).to.throw('sourceRange')

    expect(() => SourceQuotesSchema.parse({
      quotes: [
        {
          blockId: 'block-001',
          evidence: [{ref: 'document.json#block-001', text: 'Agent runtime', type: 'research'}],
          id: 'quote-001',
          text: 'Agent runtime owns orchestration.',
        },
      ],
      version: 1,
    })).to.throw('sourceRange')

    expect(() => ContentBlocksSchema.parse({
      blocks: [
        {
          evidence: [],
          id: 'block-001',
          sourceRange: [1.5, 1.5],
          text: 'Zero-length ranges are not valid evidence anchors.',
          type: 'claim',
        },
      ],
      version: 1,
    })).to.throw('greater than start')
  })

  it('validates renderer-agnostic MotionIR timelines', () => {
    const timeline = MotionTimelineSchema.parse({
      duration: 3,
      fps: 30,
      scenes: [
        {
          end: 3,
          id: 'slide-001',
          sourceId: 'slide-001',
          start: 0,
        },
      ],
      tracks: [
        {
          duration: 0.5,
          easing: 'easeOutCubic',
          from: 0,
          id: 'slide-001-title-opacity',
          property: 'opacity',
          start: 0.2,
          target: {
            kind: 'semantic',
            value: 'slide-001.title',
          },
          to: 1,
        },
        {
          duration: 0.5,
          easing: 'easeOutExpo',
          from: 42,
          id: 'slide-001-title-y',
          property: 'translateY',
          start: 0.2,
          target: {
            kind: 'css-selector',
            value: '[data-slide="slide-001"] .slide__title',
          },
          to: 0,
        },
      ],
      version: 1,
    })

    expect(timeline.fps).to.equal(30)
    expect(timeline.tracks.map((track) => track.property)).to.deep.equal(['opacity', 'translateY'])
  })

  it('validates film story index and output-timeline narration', () => {
    const storyIndex = StoryIndexSchema.parse({
      beats: [
        {
          characters: [],
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
      characters: [],
      language: 'en-US',
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
      language: 'en-US',
      segments: [
        {
          end: 5.8,
          evidence: ['beat_001', 'clip_000'],
          id: 'n001',
          overlapsSpeech: true,
          pauseAfterMs: 250,
          source: 'script',
          start: 1.2,
          text: 'The story opens with what looks like a routine assignment.',
        },
      ],
      timeline: 'output',
      version: 1,
    })

    expect(narration).to.include({
      language: 'en-US',
      timeline: 'output',
    })

    expect(() => StoryIndexSchema.parse({
      beats: [],
      characters: [
        {
          aliases: [],
          id: 'character-001',
          name: 'Protagonist',
        },
      ],
      language: 'en-US',
      source: 'input.mp4',
      sourceDuration: 5420.3,
      version: 1,
    })).to.throw('evidence')

    expect(() => OutputNarrationSchema.parse({
      segments: [],
      timeline: 'output',
      version: 1,
    })).to.throw('language')
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

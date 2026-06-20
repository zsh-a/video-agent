import {expect} from '#test/expect'

import type {MediaInfo, SpeakerScript, TimedDeck} from '@video-agent/ir'

import type {TextDeckProjectPlan} from '../../../packages/pipeline-deck/src/planning/types.js'
import {createAudioAnchoredDeckProjectPlan} from '../../../packages/pipeline-deck/src/planning/audio-anchored-plan.js'
import {createSlideTimingsFromSpeakerScript, createSlideTimingsFromTts} from '../../../packages/pipeline-deck/src/planning/timing.js'
import {createDeckVoiceoverUpdate} from '../../../packages/pipeline-deck/src/project/voiceover-update.js'
import {requireExactTranscriptSegments, requireExactTranscriptText, requireTranscriptLanguage} from '../../../packages/pipeline-deck/src/project/transcript.js'

function makeSpeakerScript(): SpeakerScript {
  return {
    language: 'zh-CN',
    mode: 'script-generated',
    segments: [
      {slideId: 'slide-001', text: 'First slide narration.'},
      {slideId: 'slide-002', text: 'Second slide narration.'},
    ],
    version: 1,
  }
}

function makeTimedDeck(): TimedDeck {
  return {
    deck: {
      format: 'portrait_1080x1920',
      inputMode: 'script-generated',
      language: 'zh-CN',
      slides: [
        {
          blockIds: [],
          evidence: [],
          motion: 'fade-in',
          points: ['First'],
          slideId: 'slide-001',
          title: 'First',
          type: 'three-points',
        },
        {
          blockIds: [],
          evidence: [],
          motion: 'fade-in',
          points: ['Second'],
          slideId: 'slide-002',
          title: 'Second',
          type: 'three-points',
        },
      ],
      theme: 'clean-white',
      title: 'Timed Deck',
      version: 1,
    },
    timings: [
      {end: 4, slideId: 'slide-001', start: 0},
      {end: 8, slideId: 'slide-002', start: 4},
    ],
    version: 1,
  }
}

describe('Deck timing updates from TTS', () => {
  it('uses LLM-authored script durations without scaling to a runtime target', () => {
    const timings = createSlideTimingsFromSpeakerScript({
      language: 'en-US',
      mode: 'script-generated',
      segments: [
        {estimatedDuration: 3, slideId: 'slide-001', text: 'First narration.'},
        {estimatedDuration: 7, slideId: 'slide-002', text: 'Second narration.'},
      ],
      version: 1,
    }, 10)

    expect(timings).to.deep.equal([
      {end: 3, slideId: 'slide-001', start: 0},
      {end: 10, slideId: 'slide-002', start: 3},
    ])
  })

  it('rejects LLM script duration target mismatches instead of scaling locally', () => {
    expect(() => createSlideTimingsFromSpeakerScript({
      language: 'en-US',
      mode: 'script-generated',
      segments: [
        {estimatedDuration: 3, slideId: 'slide-001', text: 'First narration.'},
        {estimatedDuration: 7, slideId: 'slide-002', text: 'Second narration.'},
      ],
      version: 1,
    }, 12)).to.throw('Rewrite LLM Deck plan durations instead of scaling locally')
  })

  it('rejects invalid exact ASR segments instead of silently filtering them', () => {
    expect(() => requireExactTranscriptSegments({
      language: 'en-US',
      segments: [
        {end: 1, start: 0, text: 'Valid evidence.'},
        {end: 1, start: 1, text: 'Invalid evidence.'},
      ],
      text: 'Valid evidence.',
      timestampConfidence: 'exact',
    }, 'Deck audio summary planning')).to.throw('no silent segment filtering is allowed')

    expect(() => requireExactTranscriptSegments({
      language: 'en-US',
      segments: [
        {end: 1, start: 0, text: '   '},
      ],
      text: '',
      timestampConfidence: 'exact',
    }, 'Deck audio summary planning')).to.throw('no silent segment filtering is allowed')
  })

  it('rejects missing explicit ASR transcript text instead of reconstructing it from segments', () => {
    const transcript = {
      language: 'en-US',
      segments: [
        {end: 1, start: 0, text: 'Segment text should not be reconstructed.'},
      ],
      text: '',
      timestampConfidence: 'exact' as const,
    }

    expect(() => requireExactTranscriptText(transcript, 'Deck audio summary planning')).to.throw('no segment-text transcript reconstruction fallback is allowed')
  })

  it('rejects missing or non-concrete ASR transcript language before audio Deck planning', () => {
    expect(() => requireTranscriptLanguage({
      segments: [
        {end: 1, start: 0, text: 'Audio evidence.'},
      ],
      text: 'Audio evidence.',
      timestampConfidence: 'exact',
    }, 'Deck audio summary planning')).to.throw('no target.language auto fallback is allowed')

    expect(() => requireTranscriptLanguage({
      language: 'auto',
      segments: [
        {end: 1, start: 0, text: 'Audio evidence.'},
      ],
      text: 'Audio evidence.',
      timestampConfidence: 'exact',
    }, 'Deck audio-anchored planning')).to.throw('is not concrete')

    expect(() => requireTranscriptLanguage({
      language: ' en-US ',
      segments: [
        {end: 1, start: 0, text: 'Audio evidence.'},
      ],
      text: 'Audio evidence.',
      timestampConfidence: 'exact',
    }, 'Deck audio summary planning')).to.throw('no runtime language cleanup fallback is allowed')
  })

  it('aligns TTS durations by narrationId instead of array position', () => {
    const timings = createSlideTimingsFromTts(makeSpeakerScript(), makeTimedDeck(), [
      {duration: 7, narrationId: 'narration-2', path: 'audio/tts/0002.wav'},
      {duration: 3, narrationId: 'narration-1', path: 'audio/tts/0001.wav'},
    ])

    expect(timings).to.deep.equal([
      {end: 3, slideId: 'slide-001', start: 0},
      {end: 10, slideId: 'slide-002', start: 3},
    ])
  })

  it('rejects missing TTS narration ids instead of falling back to prior timings', () => {
    expect(() => createSlideTimingsFromTts(makeSpeakerScript(), makeTimedDeck(), [
      {duration: 3, narrationId: 'narration-1', path: 'audio/tts/0001.wav'},
    ])).to.throw('missing narrationId "narration-2"')
  })

  it('rejects unexpected TTS narration ids instead of ignoring extra segments', () => {
    expect(() => createSlideTimingsFromTts(makeSpeakerScript(), makeTimedDeck(), [
      {duration: 3, narrationId: 'narration-1', path: 'audio/tts/0001.wav'},
      {duration: 7, narrationId: 'narration-2', path: 'audio/tts/0002.wav'},
      {duration: 2, narrationId: 'narration-3', path: 'audio/tts/0003.wav'},
    ])).to.throw('unexpected narrationId "narration-3"')
  })

  it('preserves LLM-authored language when anchoring Deck timing to audio', () => {
    const sourceMediaInfo: MediaInfo = {
      duration: 9,
      formatName: 'wav',
      inputPath: 'input.wav',
      probedAt: new Date(0).toISOString(),
      streams: [],
      version: 1,
    }
    const anchored = createAudioAnchoredDeckProjectPlan(makeTextDeckProjectPlan('en-US'), 'input.wav', sourceMediaInfo, 9)

    expect(anchored.deck.language).to.equal('en-US')
    expect(anchored.speakerScript.language).to.equal('en-US')
    expect(anchored.narration.language).to.equal('en-US')
    expect(anchored.storyboard.language).to.equal('en-US')
    expect(anchored.timedDeck.deck.language).to.equal('en-US')
    expect(anchored.timedDeck.timings.at(-1)?.end).to.equal(9)
  })

  it('uses LLM-authored source ranges for audio anchoring instead of proportional duration weights', () => {
    const sourceMediaInfo: MediaInfo = {
      duration: 9,
      formatName: 'wav',
      inputPath: 'input.wav',
      probedAt: new Date(0).toISOString(),
      streams: [],
      version: 1,
    }
    const plan = makeTextDeckProjectPlan('en-US')

    plan.deck.slides.push({
      ...plan.deck.slides[0]!,
      blockIds: ['block-002'],
      duration: 1,
      points: ['Second point'],
      slideId: 'slide-002',
      title: 'Second slide',
    })
    plan.speakerScript.segments.push({
      estimatedDuration: 20,
      slideId: 'slide-002',
      text: 'Second narration.',
    })
    plan.selectedMoments.moments = [
      {...plan.selectedMoments.moments[0]!, sourceRange: [0, 2], title: 'Explicit slide'},
      {...plan.selectedMoments.moments[0]!, evidence: [{ref: 'audio-transcript#slide-002', text: 'Second source evidence.', type: 'asr'}], id: 'text-slide-002', sourceRange: [2, 9], title: 'Second slide'},
    ]
    plan.storyboard.scenes.push({
      ...plan.storyboard.scenes[0]!,
      id: 'scene-2',
      sourceRange: [2, 9],
    })

    const anchored = createAudioAnchoredDeckProjectPlan(plan, 'input.wav', sourceMediaInfo, 9)

    expect(anchored.timedDeck.timings).to.deep.equal([
      {end: 2, slideId: 'slide-001', start: 0},
      {end: 9, slideId: 'slide-002', start: 2},
    ])
  })

  it('rejects audio anchoring selected moments that do not target the matching slide', () => {
    const sourceMediaInfo: MediaInfo = {
      duration: 9,
      formatName: 'wav',
      inputPath: 'input.wav',
      probedAt: new Date(0).toISOString(),
      streams: [],
      version: 1,
    }
    const plan = makeTextDeckProjectPlan('en-US')

    plan.deck.slides.push({
      ...plan.deck.slides[0]!,
      blockIds: ['block-002'],
      duration: 1,
      points: ['Second point'],
      slideId: 'slide-002',
      title: 'Second slide',
    })
    plan.speakerScript.segments.push({
      estimatedDuration: 20,
      slideId: 'slide-002',
      text: 'Second narration.',
    })
    plan.selectedMoments.moments = [
      {...plan.selectedMoments.moments[0]!, sourceRange: [0, 2], title: 'Explicit slide'},
      {...plan.selectedMoments.moments[0]!, id: 'text-slide-002', sourceRange: [2, 9], title: 'Second slide'},
    ]
    plan.storyboard.scenes.push({
      ...plan.storyboard.scenes[0]!,
      id: 'scene-2',
      sourceRange: [2, 9],
    })

    expect(() => createAudioAnchoredDeckProjectPlan(plan, 'input.wav', sourceMediaInfo, 9))
      .to.throw('no index-based selected-moment fallback is allowed')
  })

  it('rejects audio anchoring when LLM source ranges do not cover the full audio', () => {
    const sourceMediaInfo: MediaInfo = {
      duration: 9,
      formatName: 'wav',
      inputPath: 'input.wav',
      probedAt: new Date(0).toISOString(),
      streams: [],
      version: 1,
    }
    const plan = makeTextDeckProjectPlan('en-US')

    plan.selectedMoments.moments[0] = {
      ...plan.selectedMoments.moments[0]!,
      sourceRange: [0, 3],
    }

    expect(() => createAudioAnchoredDeckProjectPlan(plan, 'input.wav', sourceMediaInfo, 9)).to.throw('cover the full source audio duration')
  })

  it('rejects audio anchoring source ranges beyond duration instead of clipping them', () => {
    const sourceMediaInfo: MediaInfo = {
      duration: 9,
      formatName: 'wav',
      inputPath: 'input.wav',
      probedAt: new Date(0).toISOString(),
      streams: [],
      version: 1,
    }
    const plan = makeTextDeckProjectPlan('en-US')

    plan.selectedMoments.moments[0] = {
      ...plan.selectedMoments.moments[0]!,
      sourceRange: [0, 9.01],
    }

    expect(() => createAudioAnchoredDeckProjectPlan(plan, 'input.wav', sourceMediaInfo, 9))
      .to.throw('no runtime sourceRange clipping is allowed')
  })

  it('preserves LLM-authored source ranges when voiceover timing creates output ranges', () => {
    const plan = makeTextDeckProjectPlan('en-US')
    const update = createDeckVoiceoverUpdate({
      currentMediaInfo: plan.mediaInfo,
      currentSelectedMoments: plan.selectedMoments,
      currentStoryboard: plan.storyboard,
      currentTimedDeck: plan.timedDeck,
      deck: plan.deck,
      speakerScript: plan.speakerScript,
      ttsSegments: [
        {duration: 4, narrationId: 'narration-1', path: 'audio/tts/0001.wav'},
      ],
    })

    expect(update.storyboard.scenes[0]?.sourceRange).to.deep.equal([0, 9])
    expect(update.storyboard.scenes[0]?.outputRange).to.deep.equal([0, 4])
    expect(update.selectedMoments.moments[0]?.sourceRange).to.deep.equal([0, 9])
    expect(update.selectedMoments.moments[0]?.outputRange).to.deep.equal([0, 4])
    expect(update.qualityReport.summary.errors).to.equal(0)
  })
})

function makeTextDeckProjectPlan(language: string): TextDeckProjectPlan {
  return {
    claims: {
      claims: [{
        blockId: 'block-001',
        confidence: 0.9,
        evidence: [{ref: 'input.wav#transcript', text: 'Source evidence.', type: 'asr'}],
        id: 'claim-001',
        text: 'LLM-authored claim.',
        type: 'claim',
      }],
      version: 1,
    },
    contentBlocks: {
      blocks: [{
        evidence: [{ref: 'input.wav#transcript', text: 'Source evidence.', type: 'asr'}],
        id: 'block-001',
        sourceRange: [0, 9],
        text: 'LLM-authored block.',
        type: 'claim',
      }],
      version: 1,
    },
    deck: {
      format: 'portrait_1080x1920',
      inputMode: 'script-generated',
      language,
      slides: [{
        blockIds: ['block-001'],
        duration: 9,
        evidence: [{ref: 'input.wav#transcript', text: 'Source evidence.', type: 'asr'}],
        motion: 'fade-in',
        points: ['Explicit point'],
        slideId: 'slide-001',
        speakerNote: 'LLM-authored narration.',
        title: 'Explicit slide',
        type: 'three-points',
        visual: {assetRefs: [], kind: 'text'},
      }],
      theme: 'clean-white',
      title: 'Explicit Deck',
      version: 1,
    },
    document: {
      blocks: [{
        evidence: [{ref: 'input.wav#transcript', text: 'Source evidence.', type: 'asr'}],
        id: 'block-001',
        sourceRange: [0, 9],
        text: 'LLM-authored block.',
        type: 'claim',
      }],
      source: {
        language,
        path: 'input.wav',
        sourceType: 'audio',
        title: 'Explicit Deck',
      },
      text: 'LLM-authored document text.',
      version: 1,
    },
    mediaInfo: {
      duration: 3,
      formatName: 'text/plain',
      inputPath: 'input.wav',
      probedAt: new Date(0).toISOString(),
      streams: [],
      version: 1,
    },
    narration: {
      language,
      segments: [{
        duration: 3,
        id: 'narration-1',
        sceneId: 'scene-1',
        start: 0,
        text: 'LLM-authored narration.',
      }],
      version: 1,
    },
    outline: {
      language,
      sections: [{
        blockIds: ['block-001'],
        duration: 3,
        goal: 'LLM-authored narration.',
        id: 'section-001',
        title: 'Explicit slide',
      }],
      title: 'Explicit Deck',
      version: 1,
    },
    qualityReport: {
      checkedAt: new Date(0).toISOString(),
      issues: [],
      narrationSegments: 1,
      summary: {errors: 0, warnings: 0},
      ttsSegments: 0,
      version: 1,
    },
    selectedMoments: {
      moments: [{
        chunkId: 'text-000',
        evidence: [{ref: 'audio-transcript#slide-001', text: 'Source evidence.', type: 'asr'}],
        id: 'text-slide-001',
        reason: 'LLM-authored reason.',
        score: 0.8,
        sourceRange: [0, 9],
        summary: 'LLM-authored summary.',
        title: 'Explicit slide',
      }],
      source: 'input.wav',
      version: 1,
    },
    sourceQuotes: {
      quotes: [{
        blockId: 'block-001',
        evidence: [{ref: 'input.wav#transcript', text: 'Source evidence.', type: 'asr'}],
        id: 'quote-001',
        sourceRange: [0, 9],
        text: 'LLM-authored quote.',
      }],
      version: 1,
    },
    speakerScript: {
      language,
      mode: 'script-generated',
      segments: [{
        estimatedDuration: 3,
        slideId: 'slide-001',
        text: 'LLM-authored narration.',
      }],
      version: 1,
    },
    storyboard: {
      language,
      scenes: [{
        duration: 9,
        evidence: [{ref: 'input.wav#transcript', text: 'Source evidence.', type: 'asr'}],
        id: 'scene-1',
        narration: 'LLM-authored summary.',
        sourceRange: [0, 9],
        start: 0,
        visualStyle: 'explicit style',
      }],
      targetPlatform: 'generic',
      version: 1,
    },
    timedDeck: {
      deck: {
        format: 'portrait_1080x1920',
        inputMode: 'script-generated',
        language,
        slides: [{
          blockIds: ['block-001'],
          duration: 3,
          evidence: [{ref: 'input.wav#transcript', text: 'Source evidence.', type: 'asr'}],
          motion: 'fade-in',
          points: ['Explicit point'],
          slideId: 'slide-001',
          speakerNote: 'LLM-authored narration.',
          title: 'Explicit slide',
          type: 'three-points',
          visual: {assetRefs: [], kind: 'text'},
        }],
        theme: 'clean-white',
        title: 'Explicit Deck',
        version: 1,
      },
      timings: [{end: 3, slideId: 'slide-001', start: 0}],
      version: 1,
    },
    timeline: {
      duration: 3,
      fps: 30,
      items: [],
      version: 1,
    },
  }
}

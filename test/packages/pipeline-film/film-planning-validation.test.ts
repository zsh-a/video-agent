import {expect} from '#test/expect'

import type {CharacterIndex, ClipPlan, NarrativeBeats, RecapScript, SourceManifest, StoryIndex} from '../../../packages/ir/src/index.js'

import {RecapScriptSchema} from '../../../packages/ir/src/index.js'
import {createFilmClipPlan, validateClipPlanForCut} from '../../../packages/pipeline-film/src/planning/clip-plan.js'
import {validateGeneratedRecapScript, validateGeneratedStoryIndex} from '../../../packages/pipeline-film/src/planning/validation.js'

const sourceManifest: SourceManifest = {
  audioTracks: 1,
  duration: 10,
  orientation: 'landscape',
  sourceHash: 'source-hash',
  sourcePath: '/tmp/source.mp4',
  version: 1,
}

const storyIndex: StoryIndex = {
  beats: [
    {
      characters: ['A'],
      evidence: [{ref: 'asr-result.json#asr-001', text: 'A opens the story.', type: 'asr'}],
      id: 'beat-001',
      sourceRange: [0, 4],
      summary: 'A opens the story.',
      type: 'setup',
    },
    {
      characters: ['B'],
      evidence: [{ref: 'asr-result.json#asr-002', text: 'B changes the stakes.', type: 'asr'}],
      id: 'beat-002',
      sourceRange: [4, 9],
      summary: 'B changes the stakes.',
      type: 'climax',
    },
  ],
  characters: [],
  language: 'en-US',
  source: sourceManifest.sourcePath,
  sourceDuration: sourceManifest.duration,
  version: 1,
}

const narrativeBeats: NarrativeBeats = {
  beats: storyIndex.beats,
  source: sourceManifest.sourcePath,
  version: 1,
}

const characterIndex: CharacterIndex = {
  characters: [],
  source: sourceManifest.sourcePath,
  version: 1,
}

function clipPlan(overrides: Partial<ClipPlan> = {}): ClipPlan {
  return {
    clips: [
      {
        beatId: 'beat-001',
        duration: 2,
        id: 'clip-001',
        reason: 'LLM-selected source range.',
        sceneId: 'beat-001',
        scriptSegmentId: 'recap-script-001',
        selectionReason: 'script-driven',
        selectionRank: 1,
        source: sourceManifest.sourcePath,
        sourceRange: [0, 2],
        start: 0,
      },
    ],
    duration: 2,
    source: sourceManifest.sourcePath,
    sourceDuration: sourceManifest.duration,
    version: 1,
    ...overrides,
  }
}

function recapScript(overrides: Partial<RecapScript> = {}): RecapScript {
  return {
    hook: 'The story starts with a sharp turn.',
    language: 'en-US',
    outro: 'The final beat resolves the question.',
    segments: [
      {
        clipSelectionReason: 'The opening setup shot directly shows A beginning the story.',
        emotionalTone: 'setup',
        id: 'recap-script-001',
        narrationText: 'A opens the story with a clear setup.',
        overlapsSpeech: true,
        pauseAfterMs: 180,
        sourceRange: [0, 2],
        suggestedDuration: 2,
        targetBeatIds: ['beat-001'],
        visualGuidance: 'Use the opening setup shot.',
      },
      {
        clipSelectionReason: 'The turning-point shot shows B changing the stakes.',
        emotionalTone: 'climax',
        id: 'recap-script-002',
        narrationText: 'B changes the stakes in the central turn.',
        overlapsSpeech: false,
        pauseAfterMs: 0,
        sourceRange: [4, 7],
        suggestedDuration: 3,
        targetBeatIds: ['beat-002'],
        visualGuidance: 'Use the strongest turning-point shot.',
      },
    ],
    totalEstimatedDuration: 5,
    version: 1,
    ...overrides,
  }
}

describe('film planning validation', () => {
  it('rejects story-index source ranges outside source duration instead of clipping locally', () => {
    expect(() => validateGeneratedStoryIndex({
      characterIndex,
      narrativeBeats: {
        ...narrativeBeats,
        beats: [
          {
            ...storyIndex.beats[0]!,
            sourceRange: [8, 10.5],
          },
        ],
      },
      storyIndex: {
        ...storyIndex,
        beats: [
          {
            ...storyIndex.beats[0]!,
            sourceRange: [8, 10.5],
          },
        ],
      },
    }, sourceManifest)).to.throw('no runtime sourceRange clipping is allowed')
  })

  it('preserves LLM-authored recap durations when no target duration is provided', () => {
    const validated = validateGeneratedRecapScript(recapScript(), storyIndex, sourceManifest, undefined)
    const clipPlan = createFilmClipPlan(sourceManifest, storyIndex, undefined, validated)

    expect(validated.totalEstimatedDuration).to.equal(5)
    expect(validated.segments.map((segment) => segment.suggestedDuration)).to.deep.equal([2, 3])
    expect(clipPlan.duration).to.equal(5)
    expect(clipPlan.clips.map((clip) => clip.sourceRange)).to.deep.equal([
      [0, 2],
      [4, 7],
    ])
    expect(clipPlan.clips.map((clip) => clip.selectionReason)).to.deep.equal([
      'The opening setup shot directly shows A beginning the story.',
      'The turning-point shot shows B changing the stakes.',
    ])
  })

  it('rejects missing LLM-authored total duration instead of using a local recap target', () => {
    expect(() => validateGeneratedRecapScript(recapScript({totalEstimatedDuration: 0}), storyIndex, sourceManifest, undefined))
      .to.throw('positive totalEstimatedDuration')
    expect(() => createFilmClipPlan(sourceManifest, storyIndex, undefined, recapScript({totalEstimatedDuration: 0})))
      .to.throw('positive LLM-authored recapScript.totalEstimatedDuration')
  })

  it('rejects inconsistent LLM recap totals instead of rescaling segments without a target', () => {
    expect(() => validateGeneratedRecapScript(recapScript({totalEstimatedDuration: 6}), storyIndex, sourceManifest, undefined))
      .to.throw('segment suggestedDuration values sum')
  })

  it('rejects target-duration mismatch instead of scaling LLM script durations locally', () => {
    expect(() => validateGeneratedRecapScript(recapScript(), storyIndex, sourceManifest, 4))
      .to.throw('Rewrite LLM recap script output instead of scaling locally')
    expect(() => createFilmClipPlan(sourceManifest, storyIndex, 4, recapScript()))
      .to.throw('no runtime duration scaling is allowed')
  })

  it('rejects recap script segments with multiple beat ids instead of choosing the first one locally', () => {
    const multiBeatScript = recapScript({
      segments: [
        {
          ...recapScript().segments[0]!,
          targetBeatIds: ['beat-001', 'beat-002'],
        },
      ],
      totalEstimatedDuration: 2,
    })

    expect(() => validateGeneratedRecapScript(multiBeatScript, storyIndex, sourceManifest, undefined))
      .to.throw('no runtime beat selection fallback is allowed')
    expect(() => createFilmClipPlan(sourceManifest, storyIndex, 2, multiBeatScript))
      .to.throw('no runtime beat selection fallback is allowed')
  })

  it('rejects unknown recap script beat ids instead of filtering them out locally', () => {
    const unknownBeatScript = recapScript({
      segments: [
        {
          ...recapScript().segments[0]!,
          targetBeatIds: ['missing-beat'],
        },
      ],
      totalEstimatedDuration: 2,
    })

    expect(() => validateGeneratedRecapScript(unknownBeatScript, storyIndex, sourceManifest, undefined))
      .to.throw('references unknown story-index beat missing-beat')
    expect(() => createFilmClipPlan(sourceManifest, storyIndex, 2, unknownBeatScript))
      .to.throw('no runtime beat filtering fallback is allowed')
  })

  it('rejects target durations outside source duration instead of clipping them locally', () => {
    expect(() => validateGeneratedRecapScript(recapScript(), storyIndex, sourceManifest, 12))
      .to.throw('no runtime target duration clipping is allowed')
    expect(() => createFilmClipPlan(sourceManifest, storyIndex, 12, recapScript()))
      .to.throw('no runtime target duration clipping is allowed')
  })

  it('requires LLM-authored narration pause timing in recap scripts', () => {
    expect(() => RecapScriptSchema.parse({
      ...recapScript(),
      segments: [
        {
          clipSelectionReason: 'The opening setup shot directly shows A beginning the story.',
          emotionalTone: 'setup',
          id: 'recap-script-001',
          narrationText: 'A opens the story with a clear setup.',
          overlapsSpeech: true,
          sourceRange: [0, 2],
          suggestedDuration: 2,
          targetBeatIds: ['beat-001'],
          visualGuidance: 'Use the opening setup shot.',
        },
      ],
      totalEstimatedDuration: 2,
    })).to.throw('pauseAfterMs')
  })

  it('requires LLM-authored speech overlap decisions in recap scripts', () => {
    expect(() => RecapScriptSchema.parse({
      ...recapScript(),
      segments: [
        {
          clipSelectionReason: 'The opening setup shot directly shows A beginning the story.',
          emotionalTone: 'setup',
          id: 'recap-script-001',
          narrationText: 'A opens the story with a clear setup.',
          pauseAfterMs: 180,
          sourceRange: [0, 2],
          suggestedDuration: 2,
          targetBeatIds: ['beat-001'],
          visualGuidance: 'Use the opening setup shot.',
        },
      ],
      totalEstimatedDuration: 2,
    })).to.throw('overlapsSpeech')
  })

  it('requires LLM-authored clip selection reasons in recap scripts', () => {
    expect(() => RecapScriptSchema.parse({
      ...recapScript(),
      segments: [
        {
          emotionalTone: 'setup',
          id: 'recap-script-001',
          narrationText: 'A opens the story with a clear setup.',
          overlapsSpeech: true,
          pauseAfterMs: 180,
          sourceRange: [0, 2],
          suggestedDuration: 2,
          targetBeatIds: ['beat-001'],
          visualGuidance: 'Use the opening setup shot.',
        },
      ],
      totalEstimatedDuration: 2,
    })).to.throw('clipSelectionReason')
  })

  it('rejects overlong LLM-authored narration pauses instead of clamping locally', () => {
    expect(() => validateGeneratedRecapScript(recapScript({
      segments: [
        {
          ...recapScript().segments[0]!,
          pauseAfterMs: 2400,
        },
        recapScript().segments[1]!,
      ],
    }), storyIndex, sourceManifest, undefined))
      .to.throw('pauseAfterMs must be 2000ms or less')
  })

  it('rejects sourceRange and suggestedDuration mismatch instead of truncating clips locally', () => {
    const mismatchedScript = recapScript({
      segments: [
        {
          clipSelectionReason: 'The opening setup shot directly shows A beginning the story.',
          emotionalTone: 'setup',
          id: 'recap-script-001',
          narrationText: 'A opens the story with a clear setup.',
          overlapsSpeech: true,
          pauseAfterMs: 180,
          sourceRange: [0, 4],
          suggestedDuration: 2,
          targetBeatIds: ['beat-001'],
          visualGuidance: 'Use the opening setup shot.',
        },
      ],
      totalEstimatedDuration: 2,
    })

    expect(() => validateGeneratedRecapScript(mismatchedScript, storyIndex, sourceManifest, undefined))
      .to.throw('no runtime clip truncation is allowed')
    expect(() => createFilmClipPlan(sourceManifest, storyIndex, 2, mismatchedScript))
      .to.throw('no runtime clip truncation is allowed')
  })

  it('rejects recap script source ranges outside source duration instead of clipping locally', () => {
    const outOfBoundsScript = recapScript({
      segments: [
        {
          clipSelectionReason: 'The strongest turning-point shot shows B changing the stakes.',
          emotionalTone: 'climax',
          id: 'recap-script-001',
          narrationText: 'B changes the stakes in the central turn.',
          overlapsSpeech: false,
          pauseAfterMs: 0,
          sourceRange: [8, 10.5],
          suggestedDuration: 2.5,
          targetBeatIds: ['beat-002'],
          visualGuidance: 'Use the strongest turning-point shot.',
        },
      ],
      totalEstimatedDuration: 2.5,
    })

    expect(() => validateGeneratedRecapScript(outOfBoundsScript, storyIndex, sourceManifest, undefined))
      .to.throw('no runtime sourceRange clipping is allowed')
    expect(() => createFilmClipPlan(sourceManifest, storyIndex, 2.5, outOfBoundsScript))
      .to.throw('no runtime sourceRange clipping is allowed')
  })

  it('rejects invalid cut clips instead of silently filtering them', () => {
    expect(() => validateClipPlanForCut(clipPlan({
      clips: [
        {
          ...clipPlan().clips[0]!,
          duration: 0,
        },
      ],
    }))).to.throw('no invalid clip filtering is allowed')

    expect(() => validateClipPlanForCut(clipPlan({
      clips: [
        {
          ...clipPlan().clips[0]!,
          sourceRange: [2, 2],
        },
      ],
    }))).to.throw('no invalid clip filtering is allowed')
  })
})

import {expect} from '#test/expect'

import type {LLMClient} from '../../../packages/llm/src/index.js'

import {
  createProviders,
  LLMRequiredScriptProvider,
  LLMRequiredStoryboardProvider,
  LLMScriptProvider,
  LLMStoryboardProvider,
} from '../../../packages/providers/src/index.js'

describe('planning providers', () => {
  it('uses LLM-required planning providers by default', () => {
    const providers = createProviders({
      providers: {
        asr: 'mock',
        tts: 'mock',
        vlm: 'mock',
      },
    })

    expect(providers.storyboard).to.be.instanceOf(LLMRequiredStoryboardProvider)
    expect(providers.script).to.be.instanceOf(LLMRequiredScriptProvider)
  })

  it('uses LLM-backed planning providers when an LLM client is provided', () => {
    const providers = createProviders({
      providers: {
        asr: 'mock',
        tts: 'mock',
        vlm: 'mock',
      },
    }, {
      llmClient: createNoopLlmClient(),
    })

    expect(providers.storyboard).to.be.instanceOf(LLMStoryboardProvider)
    expect(providers.script).to.be.instanceOf(LLMScriptProvider)
  })

  it('fails storyboard generation clearly when no LLM client is configured', async () => {
    let error: unknown

    try {
      await new LLMRequiredStoryboardProvider().createStoryboard({
        mediaInfo: {
          duration: 20,
          inputPath: '/tmp/input.mp4',
          probedAt: '2026-06-16T00:00:00.000Z',
          streams: [
            {
              duration: 20,
              fps: 30,
              height: 720,
              type: 'video',
              width: 1280,
            },
          ],
          version: 1,
        },
        sceneAnalysis: [],
        transcript: {
          language: 'en',
          segments: [],
          text: '',
        },
      })
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(error instanceof Error ? error.message : '').to.contain('Storyboard generation requires an LLM provider')
  })

  it('fails narration generation clearly when no LLM client is configured', async () => {
    let error: unknown

    try {
      await new LLMRequiredScriptProvider().createNarration({
        clipPlan: {
          clips: [
            {
              duration: 3,
              id: 'clip-1',
              sceneId: 'scene-1',
              source: '/tmp/input.mp4',
              sourceRange: [5, 8],
              start: 0,
            },
          ],
          duration: 3,
          source: '/tmp/input.mp4',
          sourceDuration: 20,
          version: 1,
        },
        storyboard: {
          language: 'zh-CN',
          scenes: [
            {
              duration: 3,
              evidence: [],
              id: 'scene-1',
              narration: '这里讲解第一个关键功能。',
              sourceRange: [5, 8],
              start: 0,
              visualStyle: 'slide_explainer',
            },
          ],
          targetPlatform: 'generic',
          version: 1,
        },
      })
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(error instanceof Error ? error.message : '').to.contain('Narration generation requires an LLM provider')
  })

  it('rejects Film Recap semantic planning without an LLM client', async () => {
    let error: unknown

    try {
      await new LLMRequiredScriptProvider().createRecapScript(createRecapScriptProviderInput())
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(error instanceof Error ? error.message : '').to.contain('requires an LLM provider')
  })

  it('creates Film Recap story indexes through the LLM provider', async () => {
    let generateObjectCalls = 0
    const provider = new LLMScriptProvider({
      async generateObject() {
        generateObjectCalls += 1

        return {
          object: {
            beats: [
              {
                characters: ['protagonist'],
                evidence: [{ref: 'timeline-fusion.json#fusion-001', text: 'The clue changes the plan.', type: 'asr'}],
                id: 'beat-001',
                sourceRange: [0, 3],
                summary: 'The protagonist discovers the first clue and changes direction.',
                type: 'inciting_incident',
              },
            ],
            characters: [
              {
                aliases: [],
                description: 'The lead character seen discovering the clue.',
                evidence: [{ref: 'vlm-analysis.json#vlm-001', text: 'The protagonist studies a clue.', type: 'vlm'}],
                id: 'character-001',
                name: 'protagonist',
              },
            ],
          },
        }
      },
      async generateText() {
        throw new Error('Not used by this test.')
      },
      streamText() {
        throw new Error('Not used by this test.')
      },
    })

    const output = await provider.createStoryIndex({
      asrResult: createRecapScriptProviderInput().asrResult,
      language: 'en',
      sourceManifest: createRecapScriptProviderInput().sourceManifest,
      timelineFusion: {
        items: [
          {
            asrSegmentIds: ['asr-0001'],
            evidence: [{ref: 'asr-result.json#asr-0001', text: 'The protagonist discovers the first clue.', type: 'asr'}],
            id: 'fusion-001',
            sceneId: 'scene-001',
            silencePeriodIds: [],
            sourceRange: [0, 3],
            summary: 'The clue changes the plan.',
            vlmAnalysisIds: ['vlm-001'],
          },
        ],
        source: '/tmp/input.mp4',
        version: 1,
      },
      vlmAnalysis: createRecapScriptProviderInput().vlmAnalysis,
    })

    expect(generateObjectCalls).to.equal(1)
    expect(output.storyIndex.beats[0]?.type).to.equal('inciting_incident')
    expect(output.storyIndex.characters[0]?.name).to.equal('protagonist')
  })

  it('creates Film Recap scripts through the LLM provider', async () => {
    let generateObjectCalls = 0
    const provider = new LLMScriptProvider({
      async generateObject() {
        generateObjectCalls += 1

        return {
          object: {
            hook: 'A concrete hook.',
            language: 'en',
            outro: 'A concrete outro.',
            segments: [
              {
                emotionalTone: 'setup',
                id: 'recap-script-001',
                narrationText: 'At the start, the protagonist discovers the first clue.',
                sourceRange: [0, 3],
                suggestedDuration: 3,
                targetBeatIds: ['beat-001'],
                visualGuidance: 'Use the shot where the clue is visible.',
              },
            ],
            totalEstimatedDuration: 3,
            version: 1,
          },
        }
      },
      async generateText() {
        throw new Error('Not used by this test.')
      },
      streamText() {
        throw new Error('Not used by this test.')
      },
    })

    const script = await provider.createRecapScript({
      asrResult: {
        language: 'en',
        segments: [
          {
            end: 3,
            id: 'asr-0001',
            start: 0,
            text: 'The protagonist discovers the first clue.',
            timestampConfidence: 'exact',
          },
        ],
        text: 'The protagonist discovers the first clue.',
        timestampConfidence: 'exact',
        version: 1,
      },
      sourceManifest: {
        audioTracks: 1,
        duration: 3,
        orientation: 'landscape',
        sourceHash: 'hash',
        sourcePath: '/tmp/input.mp4',
        version: 1,
      },
      storyIndex: {
        beats: [
          {
            characters: ['protagonist'],
            evidence: [],
            id: 'beat-001',
            sourceRange: [0, 3],
            summary: 'The protagonist discovers the first clue.',
            type: 'setup',
          },
        ],
        characters: [],
        language: 'en',
        source: '/tmp/input.mp4',
        sourceDuration: 3,
        version: 1,
      },
      targetDurationSeconds: 3,
      vlmAnalysis: {
        scenes: [],
        source: '/tmp/input.mp4',
        version: 1,
      },
    })

    expect(generateObjectCalls).to.equal(1)
    expect(script.segments[0]?.targetBeatIds).to.deep.equal(['beat-001'])
    expect(script.segments[0]?.sourceRange).to.deep.equal([0, 3])
    expect(script.segments[0]?.narrationText).to.contain('first clue')
  })
})

function createRecapScriptProviderInput() {
  return {
    asrResult: {
      language: 'en',
      segments: [
        {
          end: 3,
          id: 'asr-0001',
          start: 0,
          text: 'The protagonist discovers the first clue.',
          timestampConfidence: 'exact' as const,
        },
      ],
      text: 'The protagonist discovers the first clue.',
      timestampConfidence: 'exact' as const,
      version: 1 as const,
    },
    sourceManifest: {
      audioTracks: 1,
      duration: 3,
      orientation: 'landscape' as const,
      sourceHash: 'hash',
      sourcePath: '/tmp/input.mp4',
      version: 1 as const,
    },
    storyIndex: {
      beats: [
        {
          characters: ['protagonist'],
          evidence: [],
          id: 'beat-001',
          sourceRange: [0, 3] as [number, number],
          summary: 'The protagonist discovers the first clue.',
          type: 'setup' as const,
        },
      ],
      characters: [],
      language: 'en',
      source: '/tmp/input.mp4',
      sourceDuration: 3,
      version: 1 as const,
    },
    targetDurationSeconds: 3,
    vlmAnalysis: {
      scenes: [
        {
          actions: ['discovery'],
          characters: ['protagonist'],
          emotions: ['curiosity'],
          evidence: [{ref: 'frames/film-scene-001.jpg', text: 'The protagonist studies a clue.', type: 'vlm' as const}],
          id: 'vlm-001',
          plotClues: ['first clue'],
          relationships: [],
          sceneId: 'scene-001',
          sourceRange: [0, 3] as [number, number],
          summary: 'The protagonist studies a clue.',
        },
      ],
      source: '/tmp/input.mp4',
      version: 1 as const,
    },
  }
}

function createNoopLlmClient(): LLMClient {
  return {
    async generateObject() {
      throw new Error('Not used by this test.')
    },
    async generateText() {
      throw new Error('Not used by this test.')
    },
    streamText() {
      throw new Error('Not used by this test.')
    },
  }
}

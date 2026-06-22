import {expect} from '#test/expect'

import type {LLMClient} from '../../../packages/llm/src/index.js'

import {
  createScriptProvider,
  LLMScriptProvider,
} from '../../../packages/providers/src/index.js'

describe('planning providers', () => {
  it('uses LLM-backed planning providers when an LLM client is provided', () => {
    const provider = createScriptProvider({
      llmClient: createNoopLlmClient(),
    })

    expect(provider).to.be.instanceOf(LLMScriptProvider)
  })

  it('rejects Film Recap semantic planning provider creation without an LLM client', () => {
    expect(() => createScriptProvider()).to.throw('Film Recap semantic planning requires an LLM provider')
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

  it('rejects Film Recap story indexes that omit explicit character output', async () => {
    const provider = new LLMScriptProvider({
      async generateObject() {
        return {
          object: {
            beats: [
              {
                characters: [],
                evidence: [{ref: 'timeline-fusion.json#fusion-001', text: 'The clue changes the plan.', type: 'asr'}],
                id: 'beat-001',
                sourceRange: [0, 3],
                summary: 'The protagonist discovers the first clue.',
                type: 'inciting_incident',
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

    let error: unknown

    try {
      await provider.createStoryIndex({
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
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('characters')
  })

  it('asks the LLM to rewrite invalid Film Recap story indexes with validation feedback', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: requests.length === 1
            ? {
                beats: [
                  {
                    characters: [],
                    evidence: [{ref: 'timeline-fusion.json#fusion-001', text: 'The clue changes the plan.', type: 'asr'}],
                    id: 'beat-001',
                    sourceRange: [0, 3],
                    summary: 'The protagonist discovers the first clue.',
                    type: 'inciting_incident',
                  },
                ],
              }
            : {
                beats: [
                  {
                    characters: ['protagonist'],
                    evidence: [{ref: 'timeline-fusion.json#fusion-001', text: 'The clue changes the plan.', type: 'asr'}],
                    id: 'beat-001',
                    sourceRange: [0, 3],
                    summary: 'The protagonist discovers the first clue.',
                    type: 'inciting_incident',
                  },
                ],
                characters: [],
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
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      goal: string
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.goal).to.include('complete replacement object')
    expect(rewritePayload.validationError).to.include('characters')
    expect(output.storyIndex.beats[0]?.characters).to.deep.equal(['protagonist'])
  })

  it('asks the LLM to rewrite Film Recap story-index source ranges outside the source duration', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            beats: [
              {
                characters: ['protagonist'],
                evidence: [{ref: 'timeline-fusion.json#fusion-001', text: 'The clue changes the plan.', type: 'asr'}],
                id: 'beat-001',
                sourceRange: requests.length === 1 ? [0, 4] : [0, 3],
                summary: 'The protagonist discovers the first clue.',
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

    const output = await provider.createStoryIndex(createStoryIndexProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('no runtime sourceRange clipping fallback is allowed')
    expect(output.storyIndex.beats[0]?.sourceRange).to.deep.equal([0, 3])
  })

  it('asks the LLM to rewrite Film Recap story-index text that would require runtime repair', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            beats: [
              {
                characters: ['protagonist'],
                evidence: [{ref: 'timeline-fusion.json#fusion-001', text: 'The clue changes the plan.', type: 'asr'}],
                id: 'beat-001',
                sourceRange: [0, 3],
                summary: requests.length === 1
                  ? 'The protagonist  discovers the first clue.'
                  : 'The protagonist discovers the first clue.',
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

    const output = await provider.createStoryIndex(createStoryIndexProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('no runtime whitespace repair is allowed')
    expect(output.storyIndex.beats[0]?.summary).to.equal('The protagonist discovers the first clue.')
  })

  it('creates Film Recap scripts through the LLM provider', async () => {
    let generateObjectCalls = 0
    let requestPayload: Record<string, unknown> | undefined
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        generateObjectCalls += 1
        requestPayload = JSON.parse(request.messages[0]?.content as string)

        return {
          object: {
            hook: 'A concrete hook.',
            language: 'en',
            outro: 'A concrete outro.',
            segments: [
              {
                clipSelectionReason: 'The visible clue shot directly supports the first turning point.',
                emotionalTone: 'setup',
                id: 'recap-script-001',
                narrationText: 'At the start, the protagonist discovers the first clue.',
                overlapsSpeech: true,
                pauseAfterMs: 300,
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
    expect(JSON.stringify(requestPayload)).to.include('overlapsSpeech')
    expect(JSON.stringify(requestPayload)).to.include('do not rely on runtime ASR overlap heuristics')
    expect(script.segments[0]?.targetBeatIds).to.deep.equal(['beat-001'])
    expect(script.segments[0]?.sourceRange).to.deep.equal([0, 3])
    expect(script.segments[0]?.narrationText).to.contain('first clue')
  })

  it('rejects Film Recap scripts that omit target beat ids', async () => {
    const provider = new LLMScriptProvider({
      async generateObject() {
        return {
          object: {
            hook: 'A concrete hook.',
            language: 'en',
            outro: 'A concrete outro.',
            segments: [
              {
                clipSelectionReason: 'The visible clue shot directly supports the first turning point.',
                emotionalTone: 'setup',
                id: 'recap-script-001',
                narrationText: 'At the start, the protagonist discovers the first clue.',
                overlapsSpeech: true,
                pauseAfterMs: 300,
                sourceRange: [0, 3],
                suggestedDuration: 3,
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

    let error: unknown

    try {
      await provider.createRecapScript(createRecapScriptProviderInput())
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(Error)
    expect(String(error)).to.include('targetBeatIds')
  })

  it('asks the LLM to rewrite invalid Film Recap scripts with validation feedback', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            hook: 'A concrete hook.',
            language: 'en',
            outro: 'A concrete outro.',
            segments: [
              {
                clipSelectionReason: 'The visible clue shot directly supports the first turning point.',
                emotionalTone: 'setup',
                id: 'recap-script-001',
                narrationText: 'At the start, the protagonist discovers the first clue.',
                overlapsSpeech: true,
                pauseAfterMs: 300,
                sourceRange: [0, 3],
                suggestedDuration: 3,
                ...(requests.length === 1 ? {} : {targetBeatIds: ['beat-001']}),
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

    const script = await provider.createRecapScript(createRecapScriptProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      goal: string
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.goal).to.include('complete replacement object')
    expect(rewritePayload.validationError).to.include('targetBeatIds')
    expect(script.segments[0]?.targetBeatIds).to.deep.equal(['beat-001'])
  })

  it('asks the LLM to rewrite Film Recap scripts that reference unknown story beats', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            hook: 'A concrete hook.',
            language: 'en',
            outro: 'A concrete outro.',
            segments: [
              {
                clipSelectionReason: 'The visible clue shot directly supports the first turning point.',
                emotionalTone: 'setup',
                id: 'recap-script-001',
                narrationText: 'At the start, the protagonist discovers the first clue.',
                overlapsSpeech: true,
                pauseAfterMs: 300,
                sourceRange: [0, 3],
                suggestedDuration: 3,
                targetBeatIds: [requests.length === 1 ? 'beat-missing' : 'beat-001'],
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

    const script = await provider.createRecapScript(createRecapScriptProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('no runtime beat filtering fallback is allowed')
    expect(script.segments[0]?.targetBeatIds).to.deep.equal(['beat-001'])
  })

  it('asks the LLM to rewrite Film Recap scripts with source ranges outside source duration', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            hook: 'A concrete hook.',
            language: 'en',
            outro: 'A concrete outro.',
            segments: [
              {
                clipSelectionReason: 'The visible clue shot directly supports the first turning point.',
                emotionalTone: 'setup',
                id: 'recap-script-001',
                narrationText: 'At the start, the protagonist discovers the first clue.',
                overlapsSpeech: true,
                pauseAfterMs: 300,
                sourceRange: requests.length === 1 ? [0, 4] : [0, 3],
                suggestedDuration: requests.length === 1 ? 4 : 3,
                targetBeatIds: ['beat-001'],
                visualGuidance: 'Use the shot where the clue is visible.',
              },
            ],
            totalEstimatedDuration: requests.length === 1 ? 4 : 3,
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

    const script = await provider.createRecapScript(createRecapScriptProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('no runtime sourceRange clipping fallback is allowed')
    expect(script.segments[0]?.sourceRange).to.deep.equal([0, 3])
  })

  it('asks the LLM to rewrite Film Recap scripts with duration mismatches', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            hook: 'A concrete hook.',
            language: 'en',
            outro: 'A concrete outro.',
            segments: [
              {
                clipSelectionReason: 'The visible clue shot directly supports the first turning point.',
                emotionalTone: 'setup',
                id: 'recap-script-001',
                narrationText: 'At the start, the protagonist discovers the first clue.',
                overlapsSpeech: true,
                pauseAfterMs: 300,
                sourceRange: [0, 3],
                suggestedDuration: requests.length === 1 ? 2 : 3,
                targetBeatIds: ['beat-001'],
                visualGuidance: 'Use the shot where the clue is visible.',
              },
            ],
            totalEstimatedDuration: requests.length === 1 ? 2 : 3,
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

    const script = await provider.createRecapScript(createRecapScriptProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('no runtime clip truncation is allowed')
    expect(script.segments[0]?.suggestedDuration).to.equal(3)
  })
})

function createStoryIndexProviderInput() {
  return {
    asrResult: createRecapScriptProviderInput().asrResult,
    language: 'en',
    sourceManifest: createRecapScriptProviderInput().sourceManifest,
    timelineFusion: {
      items: [
        {
          asrSegmentIds: ['asr-0001'],
          evidence: [{ref: 'asr-result.json#asr-0001', text: 'The protagonist discovers the first clue.', type: 'asr' as const}],
          id: 'fusion-001',
          sceneId: 'scene-001',
          silencePeriodIds: [],
          sourceRange: [0, 3] as [number, number],
          summary: 'The clue changes the plan.',
          vlmAnalysisIds: ['vlm-001'],
        },
      ],
      source: '/tmp/input.mp4',
      version: 1 as const,
    },
    vlmAnalysis: createRecapScriptProviderInput().vlmAnalysis,
  }
}

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

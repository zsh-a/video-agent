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

  it('asks the LLM to rewrite storyboard output that omits explicit source ranges', async () => {
    const requests: unknown[] = []
    const provider = new LLMStoryboardProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            scenes: [
              {
                duration: 3,
                evidence: [{ref: 'transcript.json#segment-001', text: 'The feature creates traceable renders.', type: 'asr'}],
                id: 'scene-001',
                narration: 'The feature creates traceable renders for review.',
                ...(requests.length === 1 ? {} : {sourceRange: [0, 3]}),
                start: 0,
                visualStyle: 'slide_explainer',
              },
            ],
            targetPlatform: 'generic',
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

    const storyboard = await provider.createStoryboard(createStoryboardProviderInput())
    const initialRequest = requests[0] as {promptMetadata?: Record<string, unknown>}
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>; promptMetadata?: Record<string, unknown>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      goal: string
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(initialRequest.promptMetadata).to.deep.include({
      id: 'film.storyboard',
      schemaName: 'Storyboard',
      stage: 'storyboard',
      version: '2026-06-20',
    })
    expect(rewriteRequest.promptMetadata).to.deep.equal(initialRequest.promptMetadata)
    expect(rewritePayload.goal).to.include('complete replacement object')
    expect(rewritePayload.validationError).to.include('sourceRange')
    expect(storyboard.scenes[0]?.sourceRange).to.deep.equal([0, 3])
  })

  it('asks the LLM to rewrite storyboard output with inconsistent source timing', async () => {
    const requests: unknown[] = []
    const provider = new LLMStoryboardProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            scenes: [
              {
                duration: requests.length === 1 ? 9 : 3,
                evidence: [{ref: 'transcript.json#segment-001', text: 'The feature creates traceable renders.', type: 'asr'}],
                id: 'scene-001',
                narration: 'The feature creates traceable renders for review.',
                sourceRange: [0, 3],
                start: 0,
                visualStyle: 'slide_explainer',
              },
            ],
            targetPlatform: 'generic',
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

    const storyboard = await provider.createStoryboard(createStoryboardProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('duration')
    expect(storyboard.scenes[0]?.duration).to.equal(3)
  })

  it('asks the LLM to rewrite storyboard text that would require runtime whitespace repair', async () => {
    const requests: unknown[] = []
    const provider = new LLMStoryboardProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            scenes: [
              {
                duration: 3,
                evidence: [{ref: 'transcript.json#segment-001', text: 'The feature creates traceable renders.', type: 'asr'}],
                id: 'scene-001',
                narration: requests.length === 1
                  ? ' The feature creates traceable renders for review.'
                  : 'The feature creates traceable renders for review.',
                sourceRange: [0, 3],
                start: 0,
                visualStyle: 'slide_explainer',
              },
            ],
            targetPlatform: 'generic',
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

    const storyboard = await provider.createStoryboard(createStoryboardProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('no runtime text trim is allowed')
    expect(storyboard.scenes[0]?.narration).to.equal('The feature creates traceable renders for review.')
  })

  it('asks the LLM to rewrite storyboard output that does not cover every selected moment', async () => {
    const requests: unknown[] = []
    const provider = new LLMStoryboardProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            scenes: [
              {
                duration: 3,
                evidence: [{ref: 'chunks/000/summary.json#moment-001', text: 'First selected moment.', type: 'research'}],
                id: 'scene-001',
                narration: 'The first selected moment introduces traceable renders.',
                sourceRange: [0, 3],
                start: 0,
                visualStyle: 'slide_explainer',
              },
              ...(requests.length === 1
                ? []
                : [{
                    duration: 3,
                    evidence: [{ref: 'chunks/001/summary.json#moment-002', text: 'Second selected moment.', type: 'research' as const}],
                    id: 'scene-002',
                    narration: 'The second selected moment shows review feedback.',
                    sourceRange: [3, 6] as [number, number],
                    start: 3,
                    visualStyle: 'slide_explainer',
                  }]),
            ],
            targetPlatform: 'generic',
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

    const storyboard = await provider.createStoryboard(createStoryboardProviderInputWithSelectedMoments())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('selected moment')
    expect(storyboard.scenes.map((scene) => scene.sourceRange)).to.deep.equal([[0, 3], [3, 6]])
  })

  it('asks the LLM to rewrite narration output that omits explicit timing', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            segments: [
              {
                id: 'narration-001',
                sceneId: 'scene-001',
                ...(requests.length === 1 ? {} : {duration: 3, start: 0}),
                text: 'The feature creates traceable renders for review.',
              },
            ],
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

    const narration = await provider.createNarration(createScriptProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      goal: string
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.goal).to.include('complete replacement object')
    expect(rewritePayload.validationError).to.include('start')
    expect(narration.segments[0]?.duration).to.equal(3)
    expect(narration.segments[0]?.start).to.equal(0)
  })

  it('asks the LLM to rewrite narration output that does not cover every storyboard scene', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            segments: [
              {
                duration: 3,
                id: 'narration-001',
                sceneId: 'scene-001',
                start: 0,
                text: 'The first scene introduces traceable renders.',
              },
              ...(requests.length === 1
                ? []
                : [{
                    duration: 3,
                    id: 'narration-002',
                    sceneId: 'scene-002',
                    start: 3,
                    text: 'The second scene shows review feedback.',
                  }]),
            ],
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

    const narration = await provider.createNarration(createScriptProviderInputWithTwoScenes())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('scene-002')
    expect(narration.segments.map((segment) => segment.sceneId)).to.deep.equal(['scene-001', 'scene-002'])
  })

  it('asks the LLM to rewrite narration output with timing outside the clip plan', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            segments: [
              {
                duration: 3,
                id: 'narration-001',
                sceneId: 'scene-001',
                start: requests.length === 1 ? 5 : 0,
                text: 'The feature creates traceable renders for review.',
              },
            ],
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

    const narration = await provider.createNarration(createScriptProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('clipPlan')
    expect(narration.segments[0]?.start).to.equal(0)
  })

  it('asks the LLM to rewrite narration text that would require runtime whitespace repair', async () => {
    const requests: unknown[] = []
    const provider = new LLMScriptProvider({
      async generateObject(request) {
        requests.push(request)

        return {
          object: {
            language: 'en',
            segments: [
              {
                duration: 3,
                id: 'narration-001',
                sceneId: 'scene-001',
                start: 0,
                text: requests.length === 1
                  ? 'The feature  creates traceable renders for review.'
                  : 'The feature creates traceable renders for review.',
              },
            ],
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

    const narration = await provider.createNarration(createScriptProviderInput())
    const rewriteRequest = requests[1] as {messages?: Array<{content?: unknown}>}
    const rewritePayload = JSON.parse(String(rewriteRequest.messages?.at(-1)?.content ?? '{}')) as {
      validationError: string
    }

    expect(requests.length).to.equal(2)
    expect(rewritePayload.validationError).to.include('no runtime whitespace repair is allowed')
    expect(narration.segments[0]?.text).to.equal('The feature creates traceable renders for review.')
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

function createStoryboardProviderInput() {
  return {
    mediaInfo: {
      duration: 3,
      inputPath: '/tmp/input.mp4',
      probedAt: '2026-06-16T00:00:00.000Z',
      streams: [
        {
          duration: 3,
          fps: 30,
          height: 720,
          type: 'video' as const,
          width: 1280,
        },
      ],
      version: 1 as const,
    },
    sceneAnalysis: [
      {
        actions: ['review'],
        characters: [],
        description: 'A product review screen shows render traces.',
        emotions: [],
        evidence: ['frames/scene-001.jpg'],
        plotClues: ['traceable renders'],
        relationships: [],
        sceneId: 'scene-001',
      },
    ],
    transcript: {
      language: 'en',
      segments: [
        {
          end: 3,
          start: 0,
          text: 'The feature creates traceable renders.',
        },
      ],
      text: 'The feature creates traceable renders.',
      timestampConfidence: 'exact' as const,
    },
  }
}

function createStoryboardProviderInputWithSelectedMoments() {
  return {
    ...createStoryboardProviderInput(),
    longVideo: {
      selectedMoments: {
        moments: [
          {
            chunkId: 'chunk-000',
            evidence: [{ref: 'chunks/000/summary.json#moment-001', text: 'First selected moment.', type: 'research' as const}],
            id: 'moment-001',
            reason: 'It introduces traceable renders.',
            score: 0.8,
            sourceRange: [0, 3] as [number, number],
            summary: 'Traceable renders are introduced.',
            title: 'Traceable renders',
          },
          {
            chunkId: 'chunk-001',
            evidence: [{ref: 'chunks/001/summary.json#moment-002', text: 'Second selected moment.', type: 'research' as const}],
            id: 'moment-002',
            reason: 'It shows review feedback.',
            score: 0.75,
            sourceRange: [3, 6] as [number, number],
            summary: 'Review feedback is shown.',
            title: 'Review feedback',
          },
        ],
        source: '/tmp/input.mp4',
        version: 1 as const,
      },
    },
    mediaInfo: {
      ...createStoryboardProviderInput().mediaInfo,
      duration: 6,
      streams: [
        {
          duration: 6,
          fps: 30,
          height: 720,
          type: 'video' as const,
          width: 1280,
        },
      ],
    },
  }
}

function createScriptProviderInput() {
  return {
    clipPlan: {
      clips: [
        {
          duration: 3,
          id: 'clip-001',
          sceneId: 'scene-001',
          source: '/tmp/input.mp4',
          sourceRange: [0, 3] as [number, number],
          start: 0,
        },
      ],
      duration: 3,
      source: '/tmp/input.mp4',
      sourceDuration: 3,
      version: 1 as const,
    },
    storyboard: {
      language: 'en',
      scenes: [
        {
          duration: 3,
          evidence: [{ref: 'transcript.json#segment-001', text: 'The feature creates traceable renders.', type: 'asr' as const}],
          id: 'scene-001',
          narration: 'The feature creates traceable renders for review.',
          sourceRange: [0, 3] as [number, number],
          start: 0,
          visualStyle: 'slide_explainer',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    },
  }
}

function createScriptProviderInputWithTwoScenes() {
  return {
    clipPlan: {
      clips: [
        {
          duration: 3,
          id: 'clip-001',
          sceneId: 'scene-001',
          source: '/tmp/input.mp4',
          sourceRange: [0, 3] as [number, number],
          start: 0,
        },
        {
          duration: 3,
          id: 'clip-002',
          sceneId: 'scene-002',
          source: '/tmp/input.mp4',
          sourceRange: [3, 6] as [number, number],
          start: 3,
        },
      ],
      duration: 6,
      source: '/tmp/input.mp4',
      sourceDuration: 6,
      version: 1 as const,
    },
    storyboard: {
      language: 'en',
      scenes: [
        {
          duration: 3,
          evidence: [{ref: 'transcript.json#segment-001', text: 'The feature creates traceable renders.', type: 'asr' as const}],
          id: 'scene-001',
          narration: 'The feature creates traceable renders for review.',
          sourceRange: [0, 3] as [number, number],
          start: 0,
          visualStyle: 'slide_explainer',
        },
        {
          duration: 3,
          evidence: [{ref: 'transcript.json#segment-002', text: 'Review feedback is visible.', type: 'asr' as const}],
          id: 'scene-002',
          narration: 'Review feedback is visible in the second scene.',
          sourceRange: [3, 6] as [number, number],
          start: 3,
          visualStyle: 'slide_explainer',
        },
      ],
      targetPlatform: 'generic' as const,
      version: 1 as const,
    },
  }
}

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

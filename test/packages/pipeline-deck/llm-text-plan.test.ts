import {expect} from '#test/expect'

import {toJSONSchema} from 'zod'

import type {GenerateObjectRequest, GenerateTextRequest, LLMClient, LLMEvent, StreamTextRequest} from '../../../packages/llm/src/index.js'
import {LLMTextDeckPlanSchema, type LLMTextDeckPlan} from '../../../packages/pipeline-deck/src/planning/llm-plan.js'
import {createLLMTextDeckProjectPlan} from '../../../packages/pipeline-deck/src/planning/llm-text-plan.js'
import {createTextDeckProjectPlanFromLLM as createStrictTextDeckProjectPlanFromLLM} from '../../../packages/pipeline-deck/src/planning/text-plan-builder.js'
import type {TextDeckProjectPlanOptions} from '../../../packages/pipeline-deck/src/planning/types.js'
import {runDeckExplainerPipeline} from '../../../packages/pipeline-deck/src/runner.js'

function deckSemantic(text: string, blockType: 'claim' | 'context' | 'data' | 'example' | 'quote' | 'recommendation' | 'summary' = 'claim') {
  return {
    blockText: text,
    blockType,
    claim: claimTypeForBlockType(blockType) === undefined
      ? null
      : {
          confidence: 0.82,
          text,
          type: claimTypeForBlockType(blockType),
        },
    momentReason: `Explain ${text}.`,
    momentScore: 0.78,
    momentSummary: text,
    sourceQuoteText: text,
    visualStyle: 'slide_explainer',
  }
}

function claimTypeForBlockType(blockType: 'claim' | 'context' | 'data' | 'example' | 'quote' | 'recommendation' | 'summary'): 'claim' | 'data' | 'recommendation' | 'summary' | undefined {
  return blockType === 'claim' || blockType === 'data' || blockType === 'recommendation' || blockType === 'summary'
    ? blockType
    : undefined
}

function deckVisual(kind: 'chart' | 'code' | 'diagram' | 'image' | 'process' | 'table' | 'text' | 'title-card' = 'text') {
  return {
    assetRefs: [],
    kind,
  }
}

function deckOutline(slideCount = 1) {
  return {
    sections: Array.from({length: slideCount}, (_, index) => ({
      goal: `Explain outline section ${index + 1}.`,
      title: `Outline ${index + 1}`,
    })),
  }
}

function withDeckTransitions<T extends {slides: Array<{transitionOut?: {duration: number; type: 'crossfade' | 'fade' | 'slide-left' | 'slide-up'} | null}>}>(plan: T): T {
  return {
    ...plan,
    slides: plan.slides.map((slide, index) => ({
      ...slide,
      transitionOut: 'transitionOut' in slide ? slide.transitionOut : (index === plan.slides.length - 1
        ? null
        : {duration: 0.55, type: 'crossfade' as const}),
    })),
  }
}

function stagedDeckObjectForRequest<T>(request: GenerateObjectRequest<T>, rawPlan: LLMTextDeckPlan): T {
  const payload = requestPayload(request) as {
    partialAnalyses?: unknown[]
    stage?: string
  }

  if (payload.stage === 'content-analysis') {
    return {
      ...(rawPlan.audience === undefined ? {} : {audience: rawPlan.audience}),
      language: rawPlan.language,
      sections: rawPlan.slides.map((slide, index) => ({
        id: `section-${String(index + 1).padStart(3, '0')}`,
        importance: slide.semantic.momentScore,
        keyClaims: [
          slide.semantic.claim === null
            ? {
                confidence: 0.7,
                sourceQuoteText: slide.semantic.sourceQuoteText,
                text: slide.semantic.blockText,
                type: 'summary' as const,
              }
            : {
                confidence: slide.semantic.claim.confidence,
                sourceQuoteText: slide.semantic.sourceQuoteText,
                text: slide.semantic.claim.text,
                type: slide.semantic.claim.type,
              },
        ],
        sourceRange: slide.sourceRange,
        summary: slide.semantic.blockText,
        title: slide.title,
      })),
      summary: rawPlan.summary,
      title: rawPlan.title,
    } as T
  }

  if (payload.stage === 'content-analysis-merge') {
    const analysis = payload.partialAnalyses?.[0]

    if (analysis === undefined) {
      throw new Error('Expected partial analysis for merge test response.')
    }

    return analysis as T
  }

  if (payload.stage === 'slide-plan') {
    return {
      slides: rawPlan.slides.map((slide, index) => ({
        ...(slide.chart === undefined ? {} : {chart: slide.chart}),
        ...(slide.code === undefined ? {} : {code: slide.code}),
        ...(slide.comparison === undefined ? {} : {comparison: slide.comparison}),
        durationIntent: slide.duration,
        motion: slide.motion,
        points: slide.points,
        ...(slide.quote === undefined ? {} : {quote: slide.quote}),
        sectionIds: [`section-${String(index + 1).padStart(3, '0')}`],
        ...(slide.stat === undefined ? {} : {stat: slide.stat}),
        ...(slide.subtitle === undefined ? {} : {subtitle: slide.subtitle}),
        title: slide.title,
        transitionOut: slide.transitionOut,
        type: slide.type,
        visual: slide.visual,
      })),
      targetPlatform: rawPlan.targetPlatform,
      theme: rawPlan.theme,
      title: rawPlan.title,
    } as T
  }

  if (payload.stage === 'script-semantics') {
    return {
      outline: rawPlan.outline,
      slides: rawPlan.slides.map((slide, index) => ({
        duration: slide.duration,
        semantic: slide.semantic,
        slideIndex: index,
        sourceRange: slide.sourceRange,
        speakerNote: slide.speakerNote,
      })),
    } as T
  }

  return rawPlan as T
}

function requestPayload<T>(request: GenerateObjectRequest<T>): Record<string, unknown> {
  const firstMessage = request.messages?.[0]

  return JSON.parse(typeof firstMessage?.content === 'string' ? firstMessage.content : '{}') as Record<string, unknown>
}

function requestStage<T>(request: GenerateObjectRequest<T>): string | undefined {
  const stage = requestPayload(request).stage

  return typeof stage === 'string' ? stage : undefined
}

function createTextDeckProjectPlanFromLLM(
  inputPath: string,
  sourceText: string,
  rawPlan: LLMTextDeckPlan,
  options: TextDeckProjectPlanOptions,
) {
  return createStrictTextDeckProjectPlanFromLLM(inputPath, sourceText, withDeckTransitions(rawPlan), {
    ...options,
    sourceType: options.sourceType ?? 'markdown',
  })
}

function createUnusedLLM(): LLMClient {
  return {
    async generateObject<T>(_request: GenerateObjectRequest<T>) {
      throw new Error('generateObject should not be called.')
    },
    async generateText(_request: GenerateTextRequest) {
      throw new Error('generateText is not used by this test.')
    },
    streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
      throw new Error('streamText is not used by this test.')
    },
  }
}

function createStaticStagedLLM(rawPlan: LLMTextDeckPlan, requests: Array<GenerateObjectRequest<unknown>> = []): LLMClient {
  return {
    async generateObject<T>(request: GenerateObjectRequest<T>) {
      requests.push(request as GenerateObjectRequest<unknown>)

      return {
        object: stagedDeckObjectForRequest(request, rawPlan),
      }
    },
    async generateText(_request: GenerateTextRequest) {
      throw new Error('generateText is not used by this test.')
    },
    streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
      throw new Error('streamText is not used by this test.')
    },
  }
}

function createOneSlideRawPlan(sourceRange: [number, number] = [0, 8]): LLMTextDeckPlan {
  return withDeckTransitions({
    language: 'en-US',
    outline: deckOutline(),
    slides: [
      {
        duration: sourceRange[1] - sourceRange[0],
        motion: 'soft-scale',
        points: ['Chunked planning'],
        semantic: deckSemantic('Chunked planning keeps long sources auditable.'),
        sourceRange,
        speakerNote: 'Explain how chunked planning keeps long sources auditable.',
        title: 'Chunked Planning',
        transitionOut: null,
        type: 'summary',
        visual: deckVisual('text'),
      },
    ],
    summary: 'Chunked planning keeps long sources auditable.',
    targetPlatform: 'generic',
    theme: 'elegant-dark',
    title: 'Chunked Planning',
  })
}

describe('Deck Explainer LLM text planning', () => {
  it('uses an LLM schema that can be represented as JSON Schema for traces and fallback prompts', () => {
    const schema = toJSONSchema(LLMTextDeckPlanSchema) as {properties?: Record<string, unknown>}

    expect(schema.properties).to.have.property('slides')
    expect(schema.properties).to.have.property('theme')
  })

  it('rejects missing input source types instead of inferring them from file extensions', async () => {
    let calls = 0
    const llm: LLMClient = {
      async generateObject<T>(_request: GenerateObjectRequest<T>) {
        calls += 1
        throw new Error('generateObject should not be called for ambiguous source types.')
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    let error: unknown

    try {
      await createLLMTextDeckProjectPlan(llm, '/tmp/source.md', 'Explain provider certification.', {
        deckFormat: 'portrait_1080x1920',
        language: 'en-US',
        maxSlideCharacters: 260,
      })
    } catch (caught) {
      error = caught
    }

    expect(calls).to.equal(0)
    expect(String(error)).to.include('requires an explicit sourceType')
    expect(String(error)).to.include('no request-time sourceType fallback is allowed')
  })

  it('allows planning only when sourceType is explicit', async () => {
    let capturedRequest: GenerateObjectRequest<unknown> | undefined
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        capturedRequest = request as GenerateObjectRequest<unknown>

        const rawPlan = withDeckTransitions({
            language: 'en-US',
            outline: deckOutline(),
            slides: [
              {
                duration: 8,
                motion: 'soft-scale',
                points: ['Certification trace'],
                semantic: deckSemantic('Provider certification keeps traces auditable.'),
                sourceRange: [0, 8],
                speakerNote: 'Provider certification keeps traces auditable.',
                title: 'Provider Certification',
                type: 'summary',
                visual: deckVisual('text'),
              },
            ],
            summary: 'Provider certification keeps traces auditable.',
            targetPlatform: 'generic',
            theme: 'elegant-dark',
            title: 'Provider Certification',
        })

        return {
          object: stagedDeckObjectForRequest(request, rawPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/source.unknown', 'Explain provider certification.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'text',
    })
    const message = capturedRequest?.messages?.[0]
    const payload = JSON.parse(typeof message?.content === 'string' ? message.content : '') as {source: {sourceType: string}}

    expect(payload.source.sourceType).to.equal('text')
    expect(plan.document.source.sourceType).to.equal('text')
  })

  it('rejects direct artifact planning without explicit sourceType instead of inferring it by extension', () => {
    expect(() => createStrictTextDeckProjectPlanFromLLM(
      '/tmp/provider.md',
      'Provider certification keeps traces auditable.',
      {
        language: 'en-US',
        outline: deckOutline(),
        slides: [
          {
            duration: 8,
            motion: 'soft-scale',
            points: ['Certification trace'],
            semantic: deckSemantic('Provider certification keeps traces auditable.'),
            sourceRange: [0, 8],
            speakerNote: 'Provider certification keeps traces auditable.',
            title: 'Provider Certification',
            transitionOut: null,
            type: 'summary',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Provider certification keeps traces auditable.',
        targetPlatform: 'generic',
        theme: 'elegant-dark',
        title: 'Provider Certification',
      },
      {
        deckFormat: 'portrait_1080x1920',
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no artifact-time sourceType fallback is allowed')
  })

  it('asks the LLM to preserve source code examples as code slides', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        const rawPlan = withDeckTransitions({
            language: 'en-US',
            outline: deckOutline(3),
            slides: [
              {
                duration: 30,
                motion: 'cinematic-rise',
	                points: ['Smallest deployable unit'],
	                semantic: deckSemantic('Pods are the smallest deployable unit.'),
		                sourceRange: [0, 30],
	                speakerNote: 'Start with what a Pod represents in Kubernetes.',
                title: 'Kubernetes Pods',
                type: 'hero',
                visual: deckVisual('title-card'),
              },
              {
                code: {
                  language: 'sh',
                  text: 'kubectl apply -f https://k8s.io/examples/pods/simple-pod.yaml',
                },
	                duration: 30,
                motion: 'blur-rise',
	                points: ['Apply a Pod manifest with kubectl.'],
	                semantic: deckSemantic('Apply a Pod manifest with kubectl.', 'example'),
		                sourceRange: [30, 60],
	                speakerNote: 'This command applies the example Pod manifest with kubectl.',
                title: 'Create a Pod',
                type: 'code',
                visual: deckVisual('code'),
              },
              {
	                duration: 30,
                motion: 'soft-scale',
	                points: ['Use workload controllers'],
	                semantic: deckSemantic('Use workload resources for ongoing management.', 'summary'),
		                sourceRange: [60, 90],
	                speakerNote: 'The takeaway is to manage Pods through controllers for real workloads.',
                title: 'Key Takeaway',
                type: 'summary',
                visual: deckVisual('text'),
              },
            ],
            summary: 'Pods are Kubernetes deployable units and can be created from manifests.',
            targetPlatform: 'generic',
            theme: 'tech-gradient',
            title: 'Kubernetes Pods',
        })

        return {
          object: stagedDeckObjectForRequest(request, rawPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(
      llm,
      '/tmp/pods.md',
      [
        '# Using Pods',
        '',
        'The following is an example of a Pod which consists of a container running nginx.',
        '',
        '{{% code_sample file="pods/simple-pod.yaml" %}}',
        '',
        'To create the Pod shown above, run the following command:',
        '',
        '```sh',
        'kubectl apply -f https://k8s.io/examples/pods/simple-pod.yaml',
        '```',
      ].join('\n'),
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 90,
        language: 'en-US',
        maxSlideCharacters: 260,
        requiredSlideTypes: ['hero', 'process', 'code', 'summary'],
        sourceType: 'markdown',
      },
    )

    const slidePlanRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan')
    const message = slidePlanRequest?.messages?.[0]
    const payload = JSON.parse(typeof message?.content === 'string' ? message.content : '') as {
      instructions: string[]
      target: {
        requiredSlideTypes?: string[]
        slideCount?: unknown
        slideCountLimits: {maximum: number; minimum: number}
        speakerNoteCharactersPerSlide?: unknown
        speakerNotePlanning: string
      }
    }

    expect(plan.deck.slides.map((slide) => slide.type)).to.include('code')
    expect(payload.instructions.join('\n')).to.include('code_sample references')
    expect(payload.instructions.join('\n')).to.include('include at least one code slide')
    expect(payload.instructions.join('\n')).to.include('preserve the executable command')
    expect(payload.instructions.join('\n')).to.include('end with a summary slide')
    expect(payload.instructions.join('\n')).to.include('Do not follow a runtime-estimated fixed slide count')
    expect(payload.target.requiredSlideTypes).to.deep.equal(['hero', 'process', 'code', 'summary'])
    expect(payload.target.slideCount).to.equal(undefined)
    expect(payload.target.slideCountLimits).to.deep.equal({maximum: 24, minimum: 4})
    expect(payload.target.speakerNoteCharactersPerSlide).to.equal(undefined)
    expect(payload.target.speakerNotePlanning).to.include('no fixed per-slide character estimate')
  })

  it('rejects visible point text over template character limits instead of clipping it locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/provider-hardening.md',
      'Provider certification needs stable failures, costs, retries, and traces.',
      {
        language: 'en-US',
        outline: deckOutline(2),
        slides: [
          {
            duration: 18,
            motion: 'spotlight',
	            points: ['把失败信息、成本、重试、trace、证据、预算和认证结果全部稳定到可审计状态'],
	            semantic: deckSemantic('把失败信息、成本、重试、trace、证据、预算和认证结果全部稳定到可审计状态'),
	            sourceRange: [0, 18],
	            speakerNote: 'Explain the single certification idea.',
            title: 'Certification',
            type: 'one-big-idea',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Provider certification stabilizes failures, cost, retries, and traces.',
        theme: 'elegant-dark',
        title: 'Provider Hardening',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 90,
        language: 'zh-CN',
        maxSlideCharacters: 260,
      },
    )).to.throw('Rewrite the slide in LLM output')
  })

  it('asks the LLM to rewrite invalid template output with validation feedback', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const invalidPoint = 'Provider certification needs stable failures cost retry traces and certification evidence.'
    let slidePlanCalls = 0
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)
        if (requestStage(request) === 'slide-plan') {
          slidePlanCalls += 1
        }

        const rawPlan = withDeckTransitions({
            language: 'en-US',
            outline: deckOutline(),
            slides: [
              {
                duration: 18,
                motion: 'spotlight',
                points: slidePlanCalls === 1 ? [invalidPoint] : ['Stable trace'],
                semantic: deckSemantic('Provider certification needs stable trace evidence.'),
                sourceRange: [0, 18],
                speakerNote: 'Explain the provider certification trace requirement.',
                title: 'Certification',
                type: 'one-big-idea',
                visual: deckVisual('text'),
              },
            ],
            summary: 'Provider certification stabilizes failures, cost, retries, and traces.',
            targetPlatform: 'generic',
            theme: 'elegant-dark',
            title: 'Provider Hardening',
        })

        return {
          object: stagedDeckObjectForRequest(request, rawPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(
      llm,
      '/tmp/provider-hardening.md',
      'Provider certification needs stable failures, costs, retries, and traces.',
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )
    const retryRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan' && (request.messages?.length ?? 0) > 1)
    const retryMessage = retryRequest?.messages?.at(-1)
    const retryPayload = JSON.parse(typeof retryMessage?.content === 'string' ? retryMessage.content : '') as {
      goal: string
      instructions: string[]
      issues: Array<{message: string}>
    }

    expect(requests.length).to.equal(5)
    expect(retryPayload.goal).to.include('complete replacement slide-plan object')
    expect(retryPayload.instructions.join('\n')).to.include('issues as binding field-level feedback')
    expect(retryPayload.issues[0]?.message).to.include('exceeding one-big-idea limit')
    expect(plan.deck.slides[0]?.points).to.deep.equal(['Stable trace'])
  })

  it('asks the LLM to rewrite slides with missing template-specific data before quality/render', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    let slidePlanCalls = 0
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)
        if (requestStage(request) === 'slide-plan') {
          slidePlanCalls += 1
        }

        const rawPlan = withDeckTransitions({
            language: 'en-US',
            outline: deckOutline(),
            slides: [
              {
                duration: 12,
                motion: 'fade-in',
                points: ['Evidence quote'],
                ...(slidePlanCalls === 1
                  ? {}
                  : {quote: {attribution: 'Provider guide', text: 'Stable failures need traceable evidence.'}}),
                semantic: deckSemantic('Stable failures need traceable evidence.', 'quote'),
                sourceRange: [0, 12],
                speakerNote: 'Read the source-backed quote and explain why it matters.',
                title: 'Trace Evidence',
                type: 'quote',
                visual: deckVisual('text'),
              },
            ],
            summary: 'Provider certification needs source-backed trace evidence.',
            targetPlatform: 'generic',
            theme: 'clean-white',
            title: 'Provider Evidence',
        })

        return {
          object: stagedDeckObjectForRequest(request, rawPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(
      llm,
      '/tmp/provider-evidence.md',
      'Stable failures need traceable evidence.',
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 12,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )
    const retryRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan' && (request.messages?.length ?? 0) > 1)
    const retryPayload = JSON.parse(String(retryRequest?.messages?.at(-1)?.content ?? '{}')) as {
      issues: Array<{message: string}>
    }

    expect(requests.length).to.equal(5)
    expect(retryPayload.issues[0]?.message).to.include('uses quote template without quote data')
    expect(plan.deck.slides[0]?.quote?.text).to.equal('Stable failures need traceable evidence.')
  })

  it('keeps asking the LLM to rewrite template violations until a valid deck is produced', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const invalidPoints = [
      'Provider certification needs stable failures cost retry traces and certification evidence.',
      'Provider certification still exceeds the visible point limit for this template.',
      'Stable trace',
    ]
    let slidePlanCalls = 0
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)
        if (requestStage(request) === 'slide-plan') {
          slidePlanCalls += 1
        }
        const point = invalidPoints[Math.min(slidePlanCalls - 1, invalidPoints.length - 1)] ?? 'Stable trace'

        const rawPlan = withDeckTransitions({
            language: 'en-US',
            outline: deckOutline(),
            slides: [
              {
                duration: 18,
                motion: 'spotlight',
                points: [point],
                semantic: deckSemantic('Provider certification needs stable trace evidence.'),
                sourceRange: [0, 18],
                speakerNote: 'Explain the provider certification trace requirement.',
                title: 'Certification',
                type: 'one-big-idea',
                visual: deckVisual('text'),
              },
            ],
            summary: 'Provider certification stabilizes failures, cost, retries, and traces.',
            targetPlatform: 'generic',
            theme: 'elegant-dark',
            title: 'Provider Hardening',
        })

        return {
          object: stagedDeckObjectForRequest(request, rawPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(
      llm,
      '/tmp/provider-hardening.md',
      'Provider certification needs stable failures, costs, retries, and traces.',
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )
    const rewriteRequests = requests.filter((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan' && (request.messages?.length ?? 0) > 1)
    const firstRewritePayload = JSON.parse(String(rewriteRequests[0]?.messages?.at(-1)?.content ?? '{}')) as {
      attemptsRemaining: number
      issues: Array<{message: string}>
    }
    const secondRewritePayload = JSON.parse(String(rewriteRequests[1]?.messages?.at(-1)?.content ?? '{}')) as {
      attemptsRemaining: number
      issues: Array<{message: string}>
    }

    expect(requests.length).to.equal(7)
    expect(firstRewritePayload.attemptsRemaining).to.equal(2)
    expect(secondRewritePayload.attemptsRemaining).to.equal(1)
    expect(secondRewritePayload.issues[0]?.message).to.include('exceeding one-big-idea limit')
    expect(plan.deck.slides[0]?.points).to.deep.equal(['Stable trace'])
  })

  it('rejects slides over maxSlideCharacters even when template fields are valid', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/max-visible.md',
      'Provider certification needs stable failures and traceable cost.',
      {
        language: 'en-US',
        outline: deckOutline(2),
        slides: [
          {
            duration: 18,
            motion: 'fade-in',
            points: ['Stable failures', 'Traceable cost'],
            semantic: deckSemantic('Provider certification needs stable failures and traceable cost.'),
            sourceRange: [0, 18],
            speakerNote: 'Explain stable failures and traceable cost.',
            title: 'Provider Checks',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Provider certification needs concise visible text.',
        theme: 'clean-white',
        title: 'Provider Checks',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 20,
      },
    )).to.throw('maxSlideCharacters 20')
  })

  it('passes timed transcript segments to the LLM and preserves authored audio source ranges', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        const rawPlan = withDeckTransitions({
            language: 'en-US',
            outline: deckOutline(),
            slides: [
              {
                duration: 10,
                motion: 'fade-in',
                points: ['Use timed source range'],
                semantic: deckSemantic('Timed transcript evidence should drive slide alignment.'),
                sourceRange: [0, 10],
                speakerNote: 'Explain the source-backed moment in order.',
                title: 'Timed Source',
                type: 'three-points',
                visual: deckVisual('text'),
              },
            ],
            summary: 'Audio source ranges should come from the LLM.',
            targetPlatform: 'generic',
            theme: 'clean-white',
            title: 'Timed Audio Deck',
        })

        return {
          object: stagedDeckObjectForRequest(request, rawPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(
      llm,
      '/tmp/source.wav',
      'Timed transcript evidence should drive slide alignment.',
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 10,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'audio',
        transcriptSegments: [
          {end: 10, start: 0, text: 'Timed transcript evidence should drive slide alignment.'},
        ],
      },
    )

    const contentAnalysisRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'content-analysis')
    const message = contentAnalysisRequest?.messages?.[0]
    const payload = JSON.parse(typeof message?.content === 'string' ? message.content : '') as {
      source: {transcriptSegments?: Array<{end: number; start: number; text: string}>}
      target: {requiresSlideSourceRanges?: boolean}
    }

    expect(payload.target.requiresSlideSourceRanges).to.equal(true)
    expect(payload.source.transcriptSegments).to.deep.equal([
      {end: 10, index: 0, start: 0, text: 'Timed transcript evidence should drive slide alignment.'},
    ])
    expect(plan.selectedMoments.moments[0]?.sourceRange).to.deep.equal([0, 10])
    expect(plan.storyboard.scenes[0]?.sourceRange).to.deep.equal([0, 10])
  })

  it('rejects missing slide sourceRange at the LLM schema boundary', () => {
    expect(() => LLMTextDeckPlanSchema.parse({language: 'en-US',
outline: deckOutline(),

        slides: [
        {
          duration: 10,
          motion: 'fade-in',
          points: ['Use timed source range'],
          semantic: deckSemantic('Timed transcript evidence should drive slide alignment.'),
          speakerNote: 'Explain the source-backed moment in order.',
          title: 'Timed Source',
          type: 'three-points',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Audio source ranges should come from the LLM.',
      theme: 'clean-white',
      title: 'Timed Audio Deck',
    })).to.throw('sourceRange')
  })

  it('rejects missing targetPlatform instead of defaulting storyboard output to generic', () => {
    expect(() => LLMTextDeckPlanSchema.parse({language: 'en-US',
outline: deckOutline(),

        slides: [
        {
          duration: 8,
          motion: 'fade-in',
          points: ['Platform choice belongs to the LLM.'],
          semantic: deckSemantic('Platform choice belongs to the LLM.'),
          sourceRange: [0, 8],
          speakerNote: 'The deck planner must choose the target platform explicitly.',
          title: 'Platform',
          type: 'three-points',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Target platform must be explicit.',
      theme: 'clean-white',
      title: 'Platform',
    })).to.throw('targetPlatform')
  })

  it('rejects missing outline instead of deriving it from slide titles and speaker notes', () => {
    expect(() => LLMTextDeckPlanSchema.parse({
      language: 'en-US',
      slides: [
        {
          duration: 10,
          motion: 'fade-in',
          points: ['Explicit outline'],
          semantic: deckSemantic('Outline sections must be LLM-authored.'),
          sourceRange: [0, 10],
          speakerNote: 'This speaker note must not become the outline goal.',
          title: 'Slide Title',
          type: 'three-points',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Outline must be explicit.',
      targetPlatform: 'generic',
      theme: 'clean-white',
      title: 'Outline Required',
    })).to.throw('outline')
  })

  it('preserves LLM-authored outline sections instead of copying slide titles and speaker notes', () => {
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/outline.md',
      'Provider certification needs a reviewable outline.',
      {
        language: 'en-US',
        outline: {
          audience: 'Provider maintainers',
          sections: [{
            goal: 'Frame why certification output must be auditable before render.',
            title: 'Audit Frame',
          }],
        },
        slides: [
          {
            duration: 10,
            motion: 'fade-in',
            points: ['Trace every failure'],
            semantic: deckSemantic('Provider certification needs a reviewable outline.'),
            sourceRange: [0, 10],
            speakerNote: 'Do not copy this speaker note into the outline.',
            title: 'Slide Title Should Not Copy',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Outline content comes from the LLM output.',
        targetPlatform: 'generic',
        theme: 'clean-white',
        title: 'Outline Preservation',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 10,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )

    expect(plan.outline.audience).to.equal('Provider maintainers')
    expect(plan.outline.sections[0]?.title).to.equal('Audit Frame')
    expect(plan.outline.sections[0]?.goal).to.equal('Frame why certification output must be auditable before render.')
    expect(plan.outline.sections[0]?.title === plan.deck.slides[0]?.title).to.equal(false)
    expect(plan.outline.sections[0]?.goal === plan.speakerScript.segments[0]?.text).to.equal(false)
  })

  it('uses per-slide LLM source quote text as evidence instead of reusing the full source text', () => {
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/provider.md',
      [
        'The source contains unrelated setup text that should not be copied into every slide evidence field.',
        'Retry evidence belongs only to the retry slide.',
        'Cost evidence belongs only to the cost slide.',
      ].join('\n'),
      {
        language: 'en-US',
        outline: deckOutline(2),
        slides: [
          {
            duration: 10,
            motion: 'fade-in',
            points: ['Retry traces'],
	            semantic: {
	              ...deckSemantic('Retries need traceable evidence.'),
	              sourceQuoteText: 'Retry evidence belongs only to the retry slide.',
	            },
	            sourceRange: [0, 10],
	            speakerNote: 'Explain retry traces.',
            title: 'Retry Evidence',
            type: 'three-points',
            visual: deckVisual('text'),
          },
          {
            duration: 10,
            motion: 'fade-in',
            points: ['Cost records'],
	            semantic: {
	              ...deckSemantic('Costs need auditable evidence.', 'data'),
	              sourceQuoteText: 'Cost evidence belongs only to the cost slide.',
	            },
	            sourceRange: [10, 20],
	            speakerNote: 'Explain cost records.',
            title: 'Cost Evidence',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Evidence should be scoped per slide.',
        targetPlatform: 'generic',
        theme: 'clean-white',
        title: 'Scoped Evidence',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 20,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )

    expect(plan.deck.slides.map((slide) => slide.evidence[0]?.text)).to.deep.equal([
      'Retry evidence belongs only to the retry slide.',
      'Cost evidence belongs only to the cost slide.',
    ])
    expect(plan.document.blocks.map((block) => block.evidence[0]?.text)).to.deep.equal([
      'Retry evidence belongs only to the retry slide.',
      'Cost evidence belongs only to the cost slide.',
    ])
    expect(plan.document.blocks.map((block) => block.sourceRange)).to.deep.equal([
      [0, 10],
      [10, 20],
    ])
    expect(plan.claims.claims.map((claim) => claim.evidence[0]?.text)).to.deep.equal([
      'Retry evidence belongs only to the retry slide.',
      'Cost evidence belongs only to the cost slide.',
    ])
    expect(plan.sourceQuotes.quotes.map((quote) => quote.evidence[0]?.text)).to.deep.equal([
      'Retry evidence belongs only to the retry slide.',
      'Cost evidence belongs only to the cost slide.',
    ])
    expect(plan.sourceQuotes.quotes.map((quote) => quote.sourceRange)).to.deep.equal([
      [0, 10],
      [10, 20],
    ])
    expect(plan.deck.slides[0]?.evidence[0]?.text?.includes('unrelated setup text')).to.equal(false)
  })

  it('preserves LLM evidence text instead of silently truncating source quotes', () => {
    const longEvidence = Array.from({length: 130}, (_, index) => `evidence-${String(index + 1).padStart(3, '0')}`).join(' ')
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/long-evidence.md',
      longEvidence,
      {
        language: 'en-US',
        outline: deckOutline(),
        slides: [
          {
            duration: 8,
            motion: 'fade-in',
            points: ['Evidence stays exact'],
            semantic: {
              ...deckSemantic('Long evidence remains exact.'),
              sourceQuoteText: longEvidence,
            },
            sourceRange: [0, 8],
            speakerNote: 'Explain why evidence should stay exact.',
            title: 'Exact Evidence',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Evidence should not be runtime truncated.',
        targetPlatform: 'generic',
        theme: 'clean-white',
        title: 'Evidence',
      },
      {
        deckFormat: 'portrait_1080x1920',
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )

    expect(longEvidence.length).to.be.greaterThan(1200)
    expect(plan.deck.slides[0]?.evidence[0]?.text).to.equal(longEvidence)
    expect(plan.document.blocks[0]?.evidence[0]?.text).to.equal(longEvidence)
    expect(plan.claims.claims[0]?.evidence[0]?.text).to.equal(longEvidence)
  })

  it('uses explicit LLM claim metadata instead of deriving claims from blockType', () => {
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/claim-control.md',
      'The LLM decides which slides become claim artifacts.',
      {
        language: 'en-US',
        outline: deckOutline(2),
        slides: [
          {
            duration: 8,
            motion: 'fade-in',
            points: ['Context only'],
            semantic: {
              blockText: 'This data-looking slide is context only.',
              blockType: 'data',
              claim: null,
              momentReason: 'It frames the discussion without making an auditable claim.',
              momentScore: 0.4,
              momentSummary: 'Context only.',
              sourceQuoteText: 'The LLM decides which slides become claim artifacts.',
              visualStyle: 'slide_explainer',
            },
            sourceRange: [0, 8],
            speakerNote: 'Explain that this is context, not a claim artifact.',
            title: 'Context',
            type: 'three-points',
            visual: deckVisual('text'),
          },
          {
            duration: 8,
            motion: 'fade-in',
            points: ['Auditable claim'],
            semantic: {
              ...deckSemantic('Explicit claim metadata creates a claim artifact.', 'context'),
              claim: {
                confidence: 0.91,
                text: 'Explicit claim metadata creates a claim artifact.',
                type: 'claim',
              },
            },
            sourceRange: [8, 16],
            speakerNote: 'Explain the explicit claim artifact.',
            title: 'Claim',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Claim artifact selection belongs to the LLM.',
        targetPlatform: 'generic',
        theme: 'clean-white',
        title: 'Claims',
      },
      {
        deckFormat: 'portrait_1080x1920',
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )

    expect(plan.document.blocks.map((block) => block.type)).to.deep.equal(['data', 'context'])
    expect(plan.claims.claims.map((claim) => ({
      blockId: claim.blockId,
      text: claim.text,
      type: claim.type,
    }))).to.deep.equal([{
      blockId: 'block-002',
      text: 'Explicit claim metadata creates a claim artifact.',
      type: 'claim',
    }])
  })

  it('rejects omitted semantic claim intent instead of treating absence as no claim artifact', () => {
    expect(() => LLMTextDeckPlanSchema.parse({language: 'en-US',
outline: deckOutline(),

        slides: [
        {
          duration: 8,
          motion: 'fade-in',
          points: ['Explicit claim intent'],
          semantic: {
            blockText: 'Claim artifact selection must be explicit.',
            blockType: 'context',
            momentReason: 'It proves the runtime cannot silently omit claims.',
            momentScore: 0.5,
            momentSummary: 'Claim artifact selection is explicit.',
            sourceQuoteText: 'Claim artifact selection must be explicit.',
            visualStyle: 'slide_explainer',
          },
          sourceRange: [0, 8],
          speakerNote: 'Explain explicit claim intent.',
          title: 'Claim Intent',
          type: 'three-points',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Claim intent must be explicit.',
      theme: 'clean-white',
      title: 'Claim Intent',
    })).to.throw('claim')
  })

  it('rejects storyboard durations that round to zero instead of applying a runtime minimum', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/tiny-duration.md',
      'A tiny duration should be rewritten by the LLM.',
      {
        language: 'en-US',
        outline: deckOutline(),
        slides: [
          {
            duration: 0.0001,
            motion: 'fade-in',
            points: ['Too short'],
            semantic: deckSemantic('Tiny durations must fail fast.'),
            sourceRange: [0, 0.0001],
            speakerNote: 'This duration is too short.',
            title: 'Tiny Duration',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Tiny durations should not be repaired.',
        theme: 'clean-white',
        title: 'Tiny Duration',
      },
      {
        deckFormat: 'portrait_1080x1920',
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )).to.throw('no runtime duration fallback is allowed')
  })

  it('rejects LLM slides that omit points instead of defaulting to an empty point list', () => {
    expect(() => LLMTextDeckPlanSchema.parse({language: 'en-US',
outline: deckOutline(),

        slides: [
        {
	          duration: 18,
	          motion: 'fade-in',
	          semantic: deckSemantic('Runtime must not synthesize missing points.'),
	          sourceRange: [0, 18],
	          speakerNote: 'Explain why the point list must be explicit.',
          title: 'No Silent Points',
          type: 'three-points',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Missing points should fail.',
      theme: 'clean-white',
      title: 'Missing Points',
    })).to.throw('points')
  })

  it('rejects code slides that omit code language instead of defaulting to text', () => {
    expect(() => LLMTextDeckPlanSchema.parse({language: 'en-US',
outline: deckOutline(),

        slides: [
        {
          code: {
            text: 'bun run test',
          },
          duration: 18,
          motion: 'blur-rise',
	          points: ['Run the test command'],
	          semantic: deckSemantic('The command must carry an explicit language.', 'example'),
	          sourceRange: [0, 18],
	          speakerNote: 'Show the exact test command.',
          title: 'Run Tests',
          type: 'code',
          visual: deckVisual('code'),
        },
      ],
      summary: 'Code language should be explicit.',
      theme: 'tech-gradient',
      title: 'Code Language',
    })).to.throw('language')
  })

  it('rejects blank code language instead of rendering it as text', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/code.md',
      'Run tests with Bun.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            code: {
              language: '   ',
              text: 'bun run test',
            },
            duration: 18,
            motion: 'blur-rise',
	            points: ['Run the test command'],
	            semantic: deckSemantic('The command must carry an explicit language.', 'example'),
	            sourceRange: [0, 18],
	            speakerNote: 'Show the exact test command.',
            title: 'Run Tests',
            type: 'code',
            visual: deckVisual('code'),
          },
        ],
        summary: 'Code language should be explicit.',
        theme: 'tech-gradient',
        title: 'Code Language',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 60,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('code.language')
  })

  it('rejects Markdown control syntax in LLM visible text instead of cleaning it locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/markdown-control.md',
      'Provider certification needs clean visible slide text.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            duration: 18,
            motion: 'fade-in',
            points: ['Stable failures'],
            semantic: deckSemantic('Provider certification should fail fast on invalid visible text.'),
            sourceRange: [0, 18],
            speakerNote: 'Explain why provider output must already be clean.',
            title: '# Provider Certification',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Markdown control text should fail.',
        theme: 'clean-white',
        title: 'Markdown Control',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no runtime Markdown cleanup is allowed')
  })

  it('rejects layout whitespace in LLM visible text instead of collapsing it locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/layout-whitespace.md',
      'Provider certification needs atomic slide fields.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            duration: 18,
            motion: 'fade-in',
            points: ['Stable failures\nwith traces'],
            semantic: deckSemantic('Provider certification should not rely on whitespace repair.'),
            sourceRange: [0, 18],
            speakerNote: 'Explain why provider output must already be field-clean.',
            title: 'Provider Certification',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Whitespace repair should fail.',
        theme: 'clean-white',
        title: 'Whitespace Repair',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no runtime whitespace repair is allowed')
  })

  it('rejects leading or trailing whitespace in LLM visible text instead of trimming it locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/trim-whitespace.md',
      'Provider certification needs exact slide fields.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            duration: 18,
            motion: 'fade-in',
            points: ['Stable failures '],
            semantic: deckSemantic('Provider certification should not rely on whitespace trim.'),
            sourceRange: [0, 18],
            speakerNote: 'Explain why provider output must already be trim-clean.',
            title: 'Provider Certification',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Whitespace trim should fail.',
        theme: 'clean-white',
        title: 'Whitespace Trim',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no runtime whitespace trim is allowed')
  })

  it('rejects speakerNote page prefixes instead of stripping them locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/page-prefix.md',
      'Provider certification needs clean narration.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            duration: 18,
            motion: 'fade-in',
            points: ['稳定失败信息'],
            semantic: deckSemantic('稳定失败信息'),
            sourceRange: [0, 18],
            speakerNote: '第 1 页：先说明失败信息必须稳定。',
            title: 'Provider Certification',
            type: 'three-points',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Page prefixes should fail.',
        theme: 'clean-white',
        title: 'Page Prefix',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'zh-CN',
        maxSlideCharacters: 260,
      },
    )).to.throw('no runtime page-prefix cleanup is allowed')
  })

  it('rejects fenced code in code slides instead of removing fences locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/fenced-code.md',
      'Run tests with Bun.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            code: {
              language: 'sh',
              text: '```sh\nbun run test\n```',
            },
            duration: 18,
            motion: 'blur-rise',
            points: ['Run the test command'],
            semantic: deckSemantic('The command must be clean code text.', 'example'),
            sourceRange: [0, 18],
            speakerNote: 'Show the exact test command.',
            title: 'Run Tests',
            type: 'code',
            visual: deckVisual('code'),
          },
        ],
        summary: 'Code fences should fail.',
        theme: 'tech-gradient',
        title: 'Code Fences',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no runtime code-fence cleanup is allowed')
  })

  it('preserves LLM-authored code text exactly instead of trimming code indentation', () => {
    const codeText = '  const result = await certifyProvider()\n  return result.traceId'
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/code-preserve.md',
      'Provider certification should show the exact request shape.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            code: {
              language: 'ts',
              text: codeText,
            },
            duration: 18,
            motion: 'blur-rise',
            points: ['Inspect the trace id'],
            semantic: deckSemantic('The command must preserve code indentation.', 'example'),
            sourceRange: [0, 18],
            speakerNote: 'Show the exact code shape and the trace id returned by certification.',
            title: 'Trace Code',
            type: 'code',
            visual: deckVisual('code'),
          },
        ],
        summary: 'Code indentation should be preserved.',
        targetPlatform: 'generic',
        theme: 'tech-gradient',
        title: 'Code Preserve',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )

    expect(plan.deck.slides[0]?.code?.text).to.equal(codeText)
  })

  it('rejects CRLF in LLM-authored code text instead of normalizing line endings', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/code-crlf.md',
      'Run tests with Bun.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            code: {
              language: 'sh',
              text: 'bun run build\r\nbun run test',
            },
            duration: 18,
            motion: 'blur-rise',
            points: ['Run build and test'],
            semantic: deckSemantic('The command must already use renderer-ready line endings.', 'example'),
            sourceRange: [0, 18],
            speakerNote: 'Show the exact build and test command sequence.',
            title: 'Run Checks',
            type: 'code',
            visual: deckVisual('code'),
          },
        ],
        summary: 'Code line endings should fail.',
        theme: 'tech-gradient',
        title: 'Code CRLF',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no runtime line-ending repair is allowed')
  })

  it('preserves LLM-authored chart bars instead of deriving chart values from points', () => {
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/chart.md',
      'Provider quality is tracked across failure clarity, cost visibility, retry stability, and trace coverage.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            chart: {
              bars: [
                {label: 'Failures', value: 0.9},
                {label: 'Cost', value: 0.72},
                {label: 'Retries', value: 0.84},
              ],
              valueLabel: 'Certification coverage',
            },
            duration: 60,
            motion: 'line-draw',
	            points: [],
	            semantic: deckSemantic('Provider certification needs visible coverage across reliability dimensions.', 'data'),
		            sourceRange: [0, 60],
	            speakerNote: 'The chart compares failure clarity, cost visibility, and retry stability as separate certification dimensions.',
            title: 'Certification Map',
            type: 'chart',
            visual: deckVisual('chart'),
          },
        ],
        summary: 'Chart data should come from the LLM output.',
        targetPlatform: 'generic',
        theme: 'elegant-dark',
        title: 'Provider Chart',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 60,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )

    expect(plan.deck.slides[0]?.chart?.bars.map((bar) => bar.value)).to.deep.equal([0.9, 0.72, 0.84])
    expect(plan.deck.slides[0]?.points).to.deep.equal([])
  })

  it('rejects chart slides without LLM-authored chart data', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/chart-missing.md',
      'Provider quality dimensions need structured chart data.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            duration: 18,
            motion: 'line-draw',
	            points: ['Failures', 'Cost', 'Retries'],
	            semantic: deckSemantic('A chart template requires explicit chart data.', 'data'),
	            sourceRange: [0, 18],
	            speakerNote: 'Explain why chart data must be explicit.',
            title: 'No Fake Chart',
            type: 'chart',
            visual: deckVisual('chart'),
          },
        ],
        summary: 'Missing chart data should fail.',
        theme: 'elegant-dark',
        title: 'Missing Chart',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 60,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('chart template without chart data')
  })

  it('rejects stat slides without LLM-authored stat data before quality/render', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/stat-missing.md',
      'Provider certification needs explicit cost data.',
      {
        language: 'en-US',
        outline: deckOutline(),
        slides: [
          {
            duration: 8,
            motion: 'number-count',
            points: ['Cost trace'],
            semantic: deckSemantic('A stat template requires explicit stat data.', 'data'),
            sourceRange: [0, 8],
            speakerNote: 'Explain why stat data must be explicit.',
            title: 'Cost Signal',
            type: 'stat',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Missing stat data should fail.',
        theme: 'finance-terminal',
        title: 'Cost Data',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 8,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('stat template without stat data')
  })

  it('rejects missing runner mode instead of defaulting to script-generated', async () => {
    let error: unknown

    try {
      await runDeckExplainerPipeline({
        inputPath: '/tmp/source.md',
        sourceType: 'markdown',
      } as unknown as Parameters<typeof runDeckExplainerPipeline>[0])
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('requires an explicit mode')
    expect(String(error)).to.include('no runner-level script-generated fallback is allowed')
  })

  it('rejects one-big-idea and cta slides that rely on subtitle instead of LLM-authored primary points', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/required-points.md',
      'The deck needs explicit primary visible points.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            duration: 12,
            motion: 'soft-scale',
            points: [],
            semantic: deckSemantic('The main idea must be an explicit point.'),
            sourceRange: [0, 12],
            speakerNote: 'Explain the explicit idea point requirement.',
            subtitle: 'Subtitle must not become the main idea.',
            title: 'Idea',
            type: 'one-big-idea',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Required visible points should fail when omitted.',
        theme: 'clean-white',
        title: 'Required Points',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 30,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('below one-big-idea minimum 1')

    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/required-cta.md',
      'The deck needs an explicit final action.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            duration: 12,
            motion: 'zoom-focus',
            points: [],
            semantic: deckSemantic('The final action must be an explicit point.', 'recommendation'),
            sourceRange: [0, 12],
            speakerNote: 'Explain the explicit action point requirement.',
            subtitle: 'Subtitle must not become the CTA.',
            title: 'Act',
            type: 'cta',
            visual: deckVisual('text'),
          },
        ],
        summary: 'CTA required visible points should fail when omitted.',
        theme: 'clean-white',
        title: 'Required CTA',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 30,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('below cta minimum 1')
  })

  it('rejects incomplete comparison content instead of dropping the comparison field', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/comparison.md',
      'Compare provider behavior.',
      {language: 'en-US',
outline: deckOutline(),

          slides: [
          {
            comparison: {
              left: {label: '---', points: ['Stable errors']},
              right: {label: 'Certified', points: ['Traceable retries']},
            },
            duration: 18,
            motion: 'card-stack',
	            points: [],
	            semantic: deckSemantic('Comparison semantics must stay explicit.'),
	            sourceRange: [0, 18],
	            speakerNote: 'Compare the two provider states.',
            title: 'Provider States',
            type: 'comparison',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Comparison cleanup should fail if labels disappear.',
        theme: 'elegant-dark',
        title: 'Comparison Cleanup',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 60,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('comparison.left.label')
  })

  it('rejects duplicate visual asset refs instead of deduping them locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/assets.md',
      'Visual asset references should be selected cleanly by the LLM.',
      {
        language: 'en-US',
        outline: deckOutline(),
        slides: [
          {
            duration: 8,
            motion: 'fade-in',
            points: ['Selected asset'],
            semantic: deckSemantic('Visual asset references should be explicit.'),
            sourceRange: [0, 8],
            speakerNote: 'Explain the selected visual asset reference.',
            title: 'Visual Assets',
            type: 'three-points',
            visual: {
              assetRefs: ['assets/provider-trace.png', 'assets/provider-trace.png'],
              kind: 'image',
            },
          },
        ],
        summary: 'Asset refs should not be deduped by the runtime.',
        targetPlatform: 'generic',
        theme: 'clean-white',
        title: 'Visual Assets',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 8,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no runtime assetRef dedupe is allowed')
  })

  it('rejects image visuals instead of ignoring unrendered visual prompts or assets', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/image-visual.md',
      'Provider certification needs a concrete visual direction.',
      {
        language: 'en-US',
        outline: deckOutline(),
        slides: [
          {
            duration: 8,
            motion: 'soft-scale',
            points: ['Concrete visual'],
            semantic: deckSemantic('Image visuals need an explicit generation prompt.'),
            sourceRange: [0, 8],
            speakerNote: 'Explain why the visual must be explicitly generated or selected.',
            title: 'Visual Direction',
            type: 'one-big-idea',
            visual: {
              assetRefs: [],
              kind: 'image',
            },
          },
        ],
        summary: 'Image visuals should not rely on renderer decoration.',
        targetPlatform: 'generic',
        theme: 'clean-white',
        title: 'Image Visual',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 8,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('no unrendered visual prompt fallback is allowed')
  })

  it('rejects prompt-only image visuals because the Deck renderer does not consume them', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/image-prompt.md',
      'Provider certification needs a concrete visual direction.',
      {
        language: 'en-US',
        outline: deckOutline(),
        slides: [
          {
            duration: 8,
            motion: 'soft-scale',
            points: ['Trace dashboard'],
            semantic: deckSemantic('Image visuals can be generated from explicit visual prompts.'),
            sourceRange: [0, 8],
            speakerNote: 'Explain the trace dashboard visual direction.',
            title: 'Trace Visual',
            type: 'one-big-idea',
            visual: {
              assetRefs: [],
              kind: 'image',
              prompt: 'Render a provider certification dashboard showing failures, cost, retries, and trace evidence.',
            },
          },
        ],
        summary: 'Image visual prompts should not be ignored.',
        targetPlatform: 'generic',
        theme: 'clean-white',
        title: 'Image Prompt',
      },
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 8,
        language: 'en-US',
        maxSlideCharacters: 260,
      },
    )).to.throw('is not renderable by the Deck renderer')
  })

  it('chunks oversized source text instead of silently truncating the LLM prompt input', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const plan = await createLLMTextDeckProjectPlan(
      createStaticStagedLLM(createOneSlideRawPlan([0, 90]), requests),
      '/tmp/long.md',
      'x'.repeat(60_001),
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 90,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )
    const stages = requests.map((request) => requestStage(request as GenerateObjectRequest<unknown>))

    expect(stages.filter((stage) => stage === 'content-analysis')).to.have.length(2)
    expect(stages).to.include('content-analysis-merge')
    expect(plan.deck.slides[0]?.title).to.equal('Chunked Planning')
  })

  it('chunks oversized timed transcript batches instead of silently dropping segments', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const plan = await createLLMTextDeckProjectPlan(
      createStaticStagedLLM(createOneSlideRawPlan([0, 600]), requests),
      '/tmp/long.wav',
      'short transcript',
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 600,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'audio',
        transcriptSegments: Array.from({length: 501}, (_, index) => ({
          end: index + 1,
          start: index,
          text: `segment ${index + 1}`,
        })),
      },
    )
    const contentAnalysisRequests = requests.filter((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'content-analysis')
    const firstPayload = requestPayload(contentAnalysisRequests[0] as GenerateObjectRequest<unknown>) as {
      source: {transcriptSegments: unknown[]}
    }
    const secondPayload = requestPayload(contentAnalysisRequests[1] as GenerateObjectRequest<unknown>) as {
      source: {transcriptSegments: unknown[]}
    }

    expect(contentAnalysisRequests).to.have.length(2)
    expect(firstPayload.source.transcriptSegments).to.have.length(500)
    expect(secondPayload.source.transcriptSegments).to.have.length(1)
    expect(plan.deck.slides[0]?.title).to.equal('Chunked Planning')
  })

  it('rejects empty timed transcript segments instead of silently dropping them', async () => {
    try {
      await createLLMTextDeckProjectPlan(
        createUnusedLLM(),
        '/tmp/empty-segment.wav',
        'short transcript',
        {
          deckFormat: 'portrait_1080x1920',
          durationTargetSeconds: 30,
          language: 'en-US',
          maxSlideCharacters: 260,
          sourceType: 'audio',
          transcriptSegments: [{
            end: 30,
            start: 0,
            text: '   ',
          }],
        },
      )
      throw new Error('Expected empty transcript segment to be rejected.')
    } catch (error) {
      expect((error as Error).message).to.include('no silent segment filtering is allowed')
    }
  })

  it('rejects timed transcript segment trim instead of silently rewriting ASR text for the LLM prompt', async () => {
    try {
      await createLLMTextDeckProjectPlan(
        createUnusedLLM(),
        '/tmp/trim-segment.wav',
        'short transcript',
        {
          deckFormat: 'portrait_1080x1920',
          durationTargetSeconds: 30,
          language: 'en-US',
          maxSlideCharacters: 260,
          sourceType: 'audio',
          transcriptSegments: [{
            end: 30,
            start: 0,
            text: ' segment with leading space',
          }],
        },
      )
      throw new Error('Expected transcript segment trim to be rejected.')
    } catch (error) {
      expect((error as Error).message).to.include('no runtime transcript segment trim is allowed')
    }
  })

  it('rejects oversized timed transcript segment text instead of silently truncating it', async () => {
    try {
      await createLLMTextDeckProjectPlan(
        createUnusedLLM(),
        '/tmp/long-segment.wav',
        'short transcript',
        {
          deckFormat: 'portrait_1080x1920',
          durationTargetSeconds: 30,
          language: 'en-US',
          maxSlideCharacters: 260,
          sourceType: 'audio',
          transcriptSegments: [{
            end: 30,
            start: 0,
            text: 'x'.repeat(501),
          }],
        },
      )
      throw new Error('Expected oversized transcript segment to be rejected.')
    } catch (error) {
      expect((error as Error).message).to.include('no silent segment truncation is allowed')
    }
  })
})

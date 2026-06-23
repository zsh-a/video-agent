import {expect} from '#test/expect'

import {toJSONSchema} from 'zod'

import type {GenerateObjectRequest, GenerateTextRequest, LLMClient, LLMEvent, StreamTextRequest} from '../../../packages/llm/src/index.js'
import {LLMTextDeckPlanSchema, LLMTextDeckScriptSemanticsSchema, LLMTextDeckSlidePlanSchema, type LLMTextDeckPlan} from '../../../packages/pipeline-deck/src/planning/llm-plan.js'
import {createLLMTextDeckProjectPlan} from '../../../packages/pipeline-deck/src/planning/llm-text-plan.js'
import {createContentAnalysisRequest, createDeckBriefRequest, createScriptSemanticsRequest} from '../../../packages/pipeline-deck/src/planning/llm-text-plan-requests.js'
import {validateLLMTextDeckScriptSemanticsTiming} from '../../../packages/pipeline-deck/src/planning/llm-text-plan-validation.js'
import {createDeckSourceMap} from '../../../packages/pipeline-deck/src/planning/source-map.js'
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
        mustCover: true,
        role: slide.semantic.blockType,
        visualRole: slide.semantic.visualStyle,
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

  if (payload.stage === 'deck-brief') {
    const analysis = payload.analysis as {
      audience?: string
      language: string
      sections: Array<{id: string; mustCover?: boolean; title: string}>
      summary: string
      title: string
    }
    const requiredSectionIds = analysis.sections.filter((section) => section.mustCover !== false).map((section) => section.id)

    return {
      ...(analysis.audience === undefined ? {} : {audience: analysis.audience}),
      densityPolicy: 'Keep each slide source-grounded and within narration budget.',
      language: analysis.language,
      narrativeArc: analysis.sections.map((section) => section.title),
      objective: analysis.summary,
      optionalSectionIds: analysis.sections.filter((section) => section.mustCover === false).map((section) => section.id),
      requiredSectionIds,
      styleIntent: 'test deck',
      targetDurationSeconds: rawPlan.slides.reduce((sum, slide) => sum + slide.duration, 0),
      targetSlideCount: rawPlan.slides.length,
      title: rawPlan.title,
    } as T
  }

  if (payload.stage === 'slide-outline') {
    return {
      slides: rawPlan.slides.map((slide, index) => ({
        goal: rawPlan.outline.sections[index]?.goal ?? slide.semantic.momentReason,
        informationRole: slide.semantic.blockType,
        mustCover: true,
        narrationBudgetSeconds: slide.duration,
        outlineId: `outline-${String(index + 1).padStart(3, '0')}`,
        sourceSectionIds: [`section-${String(index + 1).padStart(3, '0')}`],
        templateIntent: slide.type,
        visualIntent: slide.semantic.visualStyle,
      })),
    } as T
  }

  if (payload.stage === 'slide-plan') {
    return {
      slides: rawPlan.slides.map((slide, index) => ({
        ...(slide.chart === undefined ? {} : {chart: slide.chart}),
        ...(slide.code === undefined ? {} : {code: slide.code}),
        ...(slide.comparison === undefined ? {} : {comparison: slide.comparison}),
        durationIntent: slide.duration,
        motion: slide.motion,
        outlineId: `outline-${String(index + 1).padStart(3, '0')}`,
        points: slide.points,
        ...(slide.process === undefined ? {} : {process: slide.process}),
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

  if (payload.stage === 'coherence-review') {
    return {
      issues: [],
      summary: 'The deck is coherent enough for artifact build.',
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
  const sourceType = options.sourceType ?? 'markdown'
  const sourceMap = createDeckSourceMap({
    inputPath,
    language: rawPlan.language,
    sourceType,
    text: sourceText,
    title: rawPlan.title,
  })
  const sourceSectionIds = rawPlan.slides.map((_, index) => sourceMap.sections[index]?.id ?? sourceMap.sections.at(-1)?.id ?? 'source-section-001')
  const contentAnalysis = {
    ...(rawPlan.audience === undefined ? {} : {audience: rawPlan.audience}),
    generatedAt: new Date().toISOString(),
    language: rawPlan.language,
    sections: rawPlan.slides.map((slide, index) => ({
      id: sourceSectionIds[index] ?? 'source-section-001',
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
      mustCover: true,
      role: slide.semantic.blockType,
      sourceRange: sourceMap.sections[index]?.sourceRange ?? slide.sourceRange,
      summary: slide.semantic.blockText,
      title: slide.title,
      visualRole: slide.semantic.visualStyle,
    })),
    source: 'source-map.json' as const,
    summary: rawPlan.summary,
    title: rawPlan.title,
    version: 1 as const,
  }
  const deckBrief = {
    ...(rawPlan.audience === undefined ? {} : {audience: rawPlan.audience}),
    densityPolicy: 'Keep each slide source-grounded and within narration budget.',
    generatedAt: new Date().toISOString(),
    language: rawPlan.language,
    narrativeArc: rawPlan.outline.sections.map((section) => section.goal),
    objective: rawPlan.summary,
    optionalSectionIds: [],
    requiredSectionIds: sourceSectionIds,
    source: 'content-analysis.json' as const,
    styleIntent: 'test deck',
    targetDurationSeconds: options.durationTargetSeconds ?? rawPlan.slides.reduce((sum, slide) => sum + slide.duration, 0),
    targetSlideCount: rawPlan.slides.length,
    title: rawPlan.title,
    version: 1 as const,
  }
  const slideOutline = {
    generatedAt: new Date().toISOString(),
    slides: rawPlan.slides.map((slide, index) => ({
      goal: rawPlan.outline.sections[index]?.goal ?? slide.semantic.momentReason,
      informationRole: slide.semantic.blockType,
      mustCover: true,
      narrationBudgetSeconds: slide.duration,
      outlineId: slide.outlineId ?? `outline-${String(index + 1).padStart(3, '0')}`,
      sourceSectionIds: slide.sectionIds ?? [sourceSectionIds[index] ?? 'source-section-001'],
      templateIntent: slide.type,
      visualIntent: slide.semantic.visualStyle,
    })),
    source: 'deck-brief.json' as const,
    version: 1 as const,
  }
  const coherenceReport = {
    checkedAt: new Date().toISOString(),
    issues: [],
    reviewer: 'llm' as const,
    summary: {
      errors: 0,
      warnings: 0,
    },
    version: 1 as const,
  }

  return createStrictTextDeckProjectPlanFromLLM(inputPath, sourceText, withDeckTransitions(rawPlan), {
    ...options,
    coherenceReport,
    contentAnalysis,
    deckBrief,
    slideOutline,
    sourceMap,
    sourceType,
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

function createOneSlideScriptSemanticsRequestInput() {
  const rawPlan = createOneSlideRawPlan()
  const slide = rawPlan.slides[0]!

  return {
    analysis: {
      language: rawPlan.language,
      sections: [
        {
          id: 'section-001',
          importance: slide.semantic.momentScore,
          keyClaims: [
            {
              confidence: 0.82,
              sourceQuoteText: slide.semantic.sourceQuoteText,
              text: slide.semantic.blockText,
              type: 'claim' as const,
            },
          ],
          mustCover: true,
          role: slide.semantic.blockType,
          sourceRange: slide.sourceRange,
          summary: slide.semantic.blockText,
          title: slide.title,
          visualRole: slide.semantic.visualStyle,
        },
      ],
      summary: rawPlan.summary,
      title: rawPlan.title,
    },
    brief: {
      densityPolicy: 'Keep each slide source-grounded and within narration budget.',
      language: rawPlan.language,
      narrativeArc: [rawPlan.outline.sections[0]?.goal ?? slide.semantic.momentReason],
      objective: rawPlan.summary,
      optionalSectionIds: [],
      requiredSectionIds: ['section-001'],
      styleIntent: 'test deck',
      targetDurationSeconds: slide.duration,
      targetSlideCount: 1,
      title: rawPlan.title,
    },
    options: {
      deckFormat: 'portrait_1080x1920' as const,
      durationTargetSeconds: slide.duration,
      language: rawPlan.language,
      maxSlideCharacters: 260,
      sourceType: 'markdown' as const,
    },
    slideOutline: {
      slides: [
        {
          goal: rawPlan.outline.sections[0]?.goal ?? slide.semantic.momentReason,
          informationRole: slide.semantic.blockType,
          mustCover: true,
          narrationBudgetSeconds: slide.duration,
          outlineId: 'outline-001',
          sourceSectionIds: ['section-001'],
          templateIntent: slide.type,
          visualIntent: slide.semantic.visualStyle,
        },
      ],
    },
    slidePlan: {
      slides: [
        {
          durationIntent: slide.duration,
          motion: slide.motion,
          outlineId: 'outline-001',
          points: slide.points,
          sectionIds: ['section-001'],
          title: slide.title,
          transitionOut: slide.transitionOut,
          type: slide.type,
          visual: slide.visual,
        },
      ],
      targetPlatform: rawPlan.targetPlatform,
      theme: rawPlan.theme,
      title: rawPlan.title,
    },
  }
}

function requireObjectRequestForStage(requests: Array<GenerateObjectRequest<unknown>>, stage: string): GenerateObjectRequest<unknown> {
  const request = requests.find((candidate) => requestStage(candidate) === stage)

  if (request === undefined) {
    throw new Error(`Expected ${stage} request.`)
  }

  return request
}

function requireDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Expected ${label}.`)
  }

  return value
}

function assertDetailedSlideOutlineContract(requests: Array<GenerateObjectRequest<unknown>>) {
  const request = requireObjectRequestForStage(requests, 'slide-outline')
  const payload = requestPayload(request) as {
    instructions: string[]
    outputContract?: {
      forbiddenRootFieldNames?: string[]
      slide?: {forbiddenFieldNames?: string[]; required?: string[]}
    }
  }
  const outputContract = requireDefined(payload.outputContract, 'slide-outline output contract')
  const slideContract = requireDefined(outputContract.slide, 'slide-outline slide contract')

  expect(request.schemaDescription).to.include('Root must contain slides only')
  expect(payload.instructions.join('\n')).to.include('Return root slides, not outline')
  expect(outputContract.forbiddenRootFieldNames).to.include('outline')
  expect(slideContract.forbiddenFieldNames).to.include('title')
  expect(slideContract.required).to.deep.equal(['goal', 'informationRole', 'mustCover', 'narrationBudgetSeconds', 'outlineId', 'sourceSectionIds', 'templateIntent', 'visualIntent'])
}

function assertDetailedSlidePlanPromptContract(requests: Array<GenerateObjectRequest<unknown>>) {
  const request = requireObjectRequestForStage(requests, 'slide-plan')
  const payload = requestPayload(request) as {
    instructions: string[]
    target: {
      contentDensity: {
        level: string
        slideCountPolicy: string
        visibleTextPolicy: string
      }
      slideCount: {
        maximum: number
        minimum: number
        target?: number
      }
    }
  }

  expect(payload.target.contentDensity.level).to.equal('detailed')
  expect(payload.target.contentDensity.visibleTextPolicy).to.include('concrete nouns')
  expect(payload.target.contentDensity.slideCountPolicy).to.include('splitting dense source material')
  expect(payload.target.slideCount).to.deep.include({
    maximum: 3,
    minimum: 1,
    target: 1,
  })
  expect(request.promptMetadata).to.deep.include({
    id: 'deck.slide-plan',
    schemaName: 'LLMTextDeckSlidePlan',
    stage: 'slide-plan',
    version: '2026-06-20',
  })
  expect(request.promptMetadata?.inputHash).to.match(/^[a-f0-9]{64}$/u)
  expect(request.schemaDescription).to.include('Root must contain slides, targetPlatform, theme, and title')
  expect(request.schemaDescription).to.include('fade-in is not valid')
  expect(payload.instructions.join('\n')).to.include('target.contentDensity.visibleTextPolicy')
  expect(payload.instructions.join('\n')).to.include('Use requiredSlides as the binding checklist')
  expect(payload.instructions.join('\n')).to.include('For transitionOut.type use only crossfade, fade, slide-left, or slide-up')
}

function assertDetailedSlidePlanOutputContract(requests: Array<GenerateObjectRequest<unknown>>) {
  const request = requireObjectRequestForStage(requests, 'slide-plan')
  const payload = requestPayload(request) as {
    outputContract?: {
      slide?: {forbiddenFieldNames?: string[]; required?: string[]}
      slideShape?: {transitionOut?: string}
      root?: {required?: string[]}
    }
    requiredSlides: Array<{goal: string; outlineId: string; slideIndex: number}>
  }
  const outputContract = requireDefined(payload.outputContract, 'slide-plan output contract')
  const rootContract = requireDefined(outputContract.root, 'slide-plan root contract')
  const slideContract = requireDefined(outputContract.slide, 'slide-plan slide contract')
  const slideShape = requireDefined(outputContract.slideShape, 'slide-plan slide shape')

  expect(rootContract.required).to.deep.equal(['slides', 'targetPlatform', 'theme', 'title'])
  expect(slideContract.forbiddenFieldNames).to.include('speakerNote')
  expect(slideContract.required).to.include('transitionOut')
  expect(slideShape.transitionOut).to.include('do not use fade-in')
  expect(payload.requiredSlides).to.deep.equal([
    {
      goal: 'Explain outline section 1.',
      outlineId: 'outline-001',
      slideIndex: 0,
    },
  ])
}

function assertDetailedScriptPromptContract(requests: Array<GenerateObjectRequest<unknown>>) {
  const request = requireObjectRequestForStage(requests, 'script-semantics')
  const payload = requestPayload(request) as {
    instructions: string[]
    scriptOutlineObject?: {
      sections: Array<{goal: string; title: string}>
    }
    slideOutline?: unknown
    target: {
      contentDensity: {
        level: string
        narrationPolicy: string
      }
    }
  }
  const instructions = payload.instructions.join('\n')

  expect(payload.target.contentDensity.level).to.equal('detailed')
  expect(payload.target.contentDensity.narrationPolicy).to.include('concrete steps')
  expect(request.promptMetadata).to.deep.include({
    id: 'deck.script-semantics',
    schemaName: 'LLMTextDeckScriptSemantics',
    stage: 'script-semantics',
    version: '2026-06-20',
  })
  expect(request.schemaDescription).to.include('Root must contain outline and slides')
  expect(request.schemaDescription).to.include('outline.sections[].goal')
  expect(instructions).to.include('target.contentDensity.narrationPolicy')
  expect(instructions).to.include('single-line text')
  expect(instructions).to.include('Copy scriptOutlineObject exactly into the root outline field')
  expect(instructions).to.include('Root outline must be an object with sections')
  expect(instructions).to.include('Do not return slideOutline or slidePlan slide fields')
  expect(payload.slideOutline).to.equal(undefined)
  expect(payload.scriptOutlineObject).to.deep.equal({
    sections: [
      {
        goal: 'Explain outline section 1.',
        title: 'Chunked Planning',
      },
    ],
  })
}

function assertDetailedScriptOutputContract(requests: Array<GenerateObjectRequest<unknown>>) {
  const request = requireObjectRequestForStage(requests, 'script-semantics')
  const payload = requestPayload(request) as {
    outputContract?: {
      forbiddenRootFieldNames?: string[]
      outline?: {required?: string[]}
      outlineSection?: {forbiddenFieldNames?: string[]; required?: string[]}
      outlineShape?: {sections?: Array<Record<string, unknown>>; source?: string}
      root?: {required?: string[]}
      slide?: {forbiddenFieldNames?: string[]; required?: string[]}
      slideShape?: {semantic?: string; sourceRange?: string}
    }
    requiredSlides: Array<{
      outlineId: string
      sourceRangeHint: {basis: 'planned-presentation-timeline'; range: [number, number]; unit: 'seconds'}
      sourceSectionIds: string[]
      slideIndex: number
      title: string
    }>
  }
  const outputContract = requireDefined(payload.outputContract, 'script output contract')
  const rootContract = requireDefined(outputContract.root, 'script root contract')
  const outlineContract = requireDefined(outputContract.outline, 'script outline contract')
  const outlineSectionContract = requireDefined(outputContract.outlineSection, 'script outline section contract')
  const outlineShape = requireDefined(outputContract.outlineShape, 'script outline shape')
  const slideContract = requireDefined(outputContract.slide, 'script slide contract')
  const slideShape = requireDefined(outputContract.slideShape, 'script slide shape')

  expect(outputContract.forbiddenRootFieldNames).to.include('slideOutline')
  expect(rootContract.required).to.deep.equal(['outline', 'slides'])
  expect(outlineContract.required).to.deep.equal(['sections'])
  expect(outlineSectionContract.required).to.deep.equal(['goal', 'title'])
  expect(outlineSectionContract.forbiddenFieldNames).to.include('outlineId')
  expect(outlineShape.sections?.[0]).to.deep.equal({
    goal: 'non-empty string summarizing the script section goal for this slide',
    title: 'non-empty section title for this slide',
  })
  expect(outlineShape.source).to.equal('copy scriptOutlineObject exactly into root outline')
  expect(slideContract.forbiddenFieldNames).to.include('title')
  expect(slideContract.forbiddenFieldNames).to.include('outlineId')
  expect(slideContract.forbiddenFieldNames).to.include('sourceSectionIds')
  expect(slideContract.required).to.include('semantic')
  expect(slideShape.semantic).to.include('not a slide outline item')
  expect(slideShape.sourceRange).to.include('requiredSlides[].sourceRangeHint.range')
  expect(payload.requiredSlides).to.deep.equal([
    {
      outlineId: 'outline-001',
      sourceRangeHint: {
        basis: 'planned-presentation-timeline',
        range: [0, 12],
        unit: 'seconds',
      },
      sourceSectionIds: ['section-001'],
      slideIndex: 0,
      title: 'Chunked Planning',
    },
  ])
}

function assertDetailedCoherenceContract(requests: Array<GenerateObjectRequest<unknown>>) {
  const request = requireObjectRequestForStage(requests, 'coherence-review')
  const payload = requestPayload(request) as {
    instructions: string[]
    outputContract?: {
      root?: {required?: string[]}
    }
  }
  const outputContract = requireDefined(payload.outputContract, 'coherence output contract')
  const rootContract = requireDefined(outputContract.root, 'coherence root contract')

  expect(request.schemaDescription).to.include('Root must contain issues and summary only')
  expect(payload.instructions.join('\n')).to.include('Return only issues and summary at the JSON root')
  expect(rootContract.required).to.deep.equal(['issues', 'summary'])
}

describe('Deck Explainer LLM text planning', () => {
  it('uses an LLM schema that can be represented as JSON Schema for provider traces', () => {
    const schema = toJSONSchema(LLMTextDeckPlanSchema) as {properties?: Record<string, unknown>}

    expect(schema.properties).to.have.property('slides')
    expect(schema.properties).to.have.property('theme')
  })

  it('rejects invalid script semantics timing inputs instead of creating epsilon source ranges', () => {
    const input = createOneSlideScriptSemanticsRequestInput()

    expect(() => createScriptSemanticsRequest(
      '/tmp/timing.md',
      input.analysis,
      input.brief,
      {...input.slideOutline, slides: [{...input.slideOutline.slides[0]!, narrationBudgetSeconds: 0}]},
      input.slidePlan,
      input.options,
    )).to.throw('no epsilon timeline fallback is allowed')
    expect(() => createScriptSemanticsRequest(
      '/tmp/timing.md',
      input.analysis,
      input.brief,
      {slides: []},
      input.slidePlan,
      input.options,
    )).to.throw('no slide-plan duration fallback is allowed')
    expect(() => createScriptSemanticsRequest(
      '/tmp/timing.md',
      input.analysis,
      input.brief,
      input.slideOutline,
      input.slidePlan,
      {...input.options, durationTargetSeconds: 0},
    )).to.throw('Deck script timeline target duration must be a positive finite number')
  })

  it('rejects empty script semantics speaker notes instead of applying a minimum duration estimate', () => {
    const input = createOneSlideScriptSemanticsRequestInput()

    expect(() => validateLLMTextDeckScriptSemanticsTiming({
      outline: deckOutline(),
      slides: [
        {
          duration: 8,
          semantic: deckSemantic('Empty speaker notes should not be timed.'),
          slideIndex: 0,
          sourceRange: [0, 8],
          speakerNote: '   ',
        },
      ],
    }, input.slideOutline, input.options)).to.throw('no minimum speakerNote-duration fallback is allowed')
  })

  it('normalizes LLM slide durations to the requested deck target before artifact timing', () => {
    const plan = createTextDeckProjectPlanFromLLM(
      '/tmp/normalize-duration.md',
      'First operational step.\n\nSecond operational step.',
      withDeckTransitions({
        language: 'en-US',
        outline: deckOutline(2),
        slides: [
          {
            duration: 10,
            motion: 'soft-scale',
            points: ['First step'],
            semantic: deckSemantic('Explain the first operational step.'),
            sourceRange: [0, 5],
            speakerNote: 'First step.',
            title: 'First',
            type: 'summary',
            visual: deckVisual('text'),
          },
          {
            duration: 10,
            motion: 'soft-scale',
            points: ['Second step'],
            semantic: deckSemantic('Explain the second operational step.'),
            sourceRange: [5, 10],
            speakerNote: 'Second step.',
            title: 'Second',
            type: 'summary',
            visual: deckVisual('text'),
          },
        ],
        summary: 'Two steps are normalized into the requested duration.',
        targetPlatform: 'generic',
        theme: 'elegant-dark',
        title: 'Duration Normalization',
      }),
      {
        deckFormat: 'landscape_1920x1080',
        durationTargetSeconds: 12,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )

    expect(plan.deck.slides.map((slide) => slide.duration)).to.deep.equal([6, 6])
    expect(plan.mediaInfo.duration).to.equal(12)
    expect(plan.timedDeck.timings.at(-1)?.end).to.equal(12)
  })

  it('passes requested content density into LLM planning targets', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const llm = createStaticStagedLLM(createOneSlideRawPlan([0, 12]), requests)

    await createLLMTextDeckProjectPlan(llm, '/tmp/density.md', 'Detailed generation should preserve source examples and caveats.', {
      contentDensity: 'detailed',
      deckFormat: 'landscape_1920x1080',
      durationTargetSeconds: 12,
      language: 'en-US',
      maxSlideCharacters: 260,
      slideCountMax: 3,
      slideCountTarget: 1,
      sourceType: 'markdown',
    })

    assertDetailedSlideOutlineContract(requests)
    assertDetailedSlidePlanPromptContract(requests)
    assertDetailedSlidePlanOutputContract(requests)
    assertDetailedScriptPromptContract(requests)
    assertDetailedScriptOutputContract(requests)
    assertDetailedCoherenceContract(requests)
  })

  it('passes planned timeline ranges into script-semantics sourceRange hints', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const llm = createStaticStagedLLM(withDeckTransitions({
      language: 'en-US',
      outline: deckOutline(2),
      slides: [
        {
          duration: 5,
          motion: 'soft-scale',
          points: ['First step'],
          semantic: deckSemantic('First step turns evidence into action.'),
          sourceRange: [0, 5],
          speakerNote: 'Explain the first operational step.',
          title: 'First Step',
          transitionOut: {duration: 0.55, type: 'crossfade'},
          type: 'summary',
          visual: deckVisual('text'),
        },
        {
          duration: 7,
          motion: 'soft-scale',
          points: ['Second step'],
          semantic: deckSemantic('Second step keeps validation explicit.'),
          sourceRange: [5, 12],
          speakerNote: 'Explain the second operational step.',
          title: 'Second Step',
          transitionOut: null,
          type: 'summary',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Timeline hints cover the planned deck duration.',
      targetPlatform: 'generic',
      theme: 'elegant-dark',
      title: 'Timeline Hints',
    }), requests)

    await createLLMTextDeckProjectPlan(llm, '/tmp/timeline-hints.md', 'First step.\n\nSecond step.', {
      deckFormat: 'landscape_1920x1080',
      durationTargetSeconds: 12,
      language: 'en-US',
      maxSlideCharacters: 260,
      slideCountMax: 3,
      slideCountTarget: 2,
      sourceType: 'markdown',
    })

    const scriptPayload = requestPayload(requests.find((request) => requestStage(request) === 'script-semantics') as GenerateObjectRequest<unknown>) as {
      instructions: string[]
      requiredSlides: Array<{sourceRangeHint: {basis: string; range: [number, number]; unit: string}; sourceSectionIds: string[]}>
    }

    expect(scriptPayload.instructions.join('\n')).to.include('planned presentation timeline range in seconds')
    expect(scriptPayload.instructions.join('\n')).to.include('copy its range exactly')
    expect(scriptPayload.requiredSlides.map((slide) => slide.sourceRangeHint)).to.deep.equal([
      {
        basis: 'planned-presentation-timeline',
        range: [0, 5],
        unit: 'seconds',
      },
      {
        basis: 'planned-presentation-timeline',
        range: [5, 12],
        unit: 'seconds',
      },
    ])
    expect(scriptPayload.requiredSlides.map((slide) => slide.sourceSectionIds)).to.deep.equal([
      ['section-001'],
      ['section-002'],
    ])
  })

  it('rejects overfilled comparison slide-plan data at the schema boundary', () => {
    const result = LLMTextDeckSlidePlanSchema.safeParse({
      slides: [
        {
          comparison: {
            left: {label: 'Alpha strength', points: ['Demand certainty', 'Transmission clarity', 'Business purity', 'Market-cap elasticity']},
            right: {label: 'Position posture', points: ['Observe', 'Test small', 'Exit']},
          },
          durationIntent: 24,
          motion: 'card-stack',
          outlineId: 'slide-001',
          points: ['Score and size by evidence'],
          sectionIds: ['source-section-001'],
          title: 'Score and Size',
          transitionOut: null,
          type: 'comparison',
          visual: deckVisual('text'),
        },
      ],
      targetPlatform: 'generic',
      theme: 'elegant-dark',
      title: 'Comparison Limit',
    })

    expect(result.success).to.equal(false)
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'slides.0.comparison.left.points')).to.equal(true)
  })

  it('allows longer raw slide-plan points so template validation can provide template-specific feedback', () => {
    const result = LLMTextDeckSlidePlanSchema.safeParse({
      slides: [
        {
          durationIntent: 12,
          motion: 'stagger-up',
          outlineId: 'slide-001',
          points: ['Provider certification needs stable failures cost retry trace evidence'],
          sectionIds: ['source-section-001'],
          title: 'Point Limit',
          transitionOut: null,
          type: 'three-points',
          visual: deckVisual('text'),
        },
      ],
      targetPlatform: 'generic',
      theme: 'elegant-dark',
      title: 'Point Limit',
    })

    expect(result.success).to.equal(true)
  })

  it('accepts structured process steps with practical detail at the schema boundary', () => {
    const result = LLMTextDeckSlidePlanSchema.safeParse({
      slides: [
        {
          durationIntent: 30,
          motion: 'line-draw',
          outlineId: 'slide-001',
          points: [],
          process: {
            steps: [
              {detail: 'Check orders, MAU, channel inventory, and planned capacity.', label: 'Separate news from demand'},
              {detail: 'Translate volume, price, and fee rate into revenue impact.', label: 'Map revenue transmission'},
              {detail: 'Confirm purity above 60% and market cap below 5B.', label: 'Test small-cap elasticity'},
            ],
          },
          sectionIds: ['source-section-001'],
          title: 'Workflow',
          transitionOut: null,
          type: 'process',
          visual: deckVisual('process'),
        },
      ],
      targetPlatform: 'generic',
      theme: 'elegant-dark',
      title: 'Process Detail',
    })

    expect(result.success).to.equal(true)
  })

  it('rejects layout whitespace in script semantic text at the schema boundary', () => {
    const result = LLMTextDeckScriptSemanticsSchema.safeParse({
      outline: {
        sections: [{goal: 'Explain clean semantic text.', title: 'Clean Semantics'}],
      },
      slides: [
        {
          duration: 12,
          semantic: {
            blockText: 'Provider certification\nneeds clean semantic text.',
            blockType: 'summary',
            claim: null,
            momentReason: 'The slide explains why semantic text must already be clean.',
            momentScore: 0.8,
            momentSummary: 'Clean semantic fields avoid runtime whitespace repair.',
            sourceQuoteText: 'Provider certification needs clean semantic text.',
            visualStyle: 'Summary card',
          },
          slideIndex: 0,
          sourceRange: [0, 12],
          speakerNote: 'Explain clean semantic text.',
        },
      ],
    })

    expect(result.success).to.equal(false)
    expect(result.error?.issues.some((issue) => issue.path.join('.') === 'slides.0.semantic.blockText')).to.equal(true)
  })

  it('allows source quote text to preserve source Markdown evidence at the schema boundary', () => {
    const result = LLMTextDeckScriptSemanticsSchema.safeParse({
      outline: {
        sections: [{goal: 'Explain source-backed evidence.', title: 'Source Evidence'}],
      },
      slides: [
        {
          duration: 12,
          semantic: {
            blockText: 'Source quote evidence can preserve original syntax.',
            blockType: 'summary',
            claim: null,
            momentReason: 'The slide explains why source quote text is evidence metadata.',
            momentScore: 0.8,
            momentSummary: 'Source quote text remains faithful to the source.',
            sourceQuoteText: '| Dimension | Question |\n| --- | --- |\n| Demand certainty | Is this already occurring? |',
            visualStyle: 'Summary card',
          },
          slideIndex: 0,
          sourceRange: [0, 12],
          speakerNote: 'Explain why source quote evidence can retain source formatting.',
        },
      ],
    })

    expect(result.success).to.equal(true)
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
        if (requestStage(request as GenerateObjectRequest<unknown>) === 'content-analysis') {
          capturedRequest = request as GenerateObjectRequest<unknown>
        }

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

  it('normalizes LLM-authored script outline arrays after generation', async () => {
    const rawPlan = createOneSlideRawPlan([0, 8])
    let returnedArrayOutline = false
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        const object = stagedDeckObjectForRequest(request, rawPlan) as {
          outline?: {sections?: unknown[]}
        }

        if (requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics') {
          returnedArrayOutline = true

          return {
            object: {
              ...object,
              outline: object.outline?.sections,
            } as T,
          }
        }

        return {
          object: object as T,
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/source.md', 'Explain provider schema recovery.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })

    expect(returnedArrayOutline).to.equal(true)
    expect(plan.outline.sections.map((section) => ({
      goal: section.goal,
      title: section.title,
    }))).to.deep.equal(rawPlan.outline.sections)
  })

  it('normalizes LLM-authored script outline source wrappers after generation', async () => {
    const rawPlan = createOneSlideRawPlan([0, 8])
    let returnedSourceOutline = false
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        const object = stagedDeckObjectForRequest(request, rawPlan) as {
          outline?: {sections?: unknown[]}
        }

        if (requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics') {
          returnedSourceOutline = true

          return {
            object: {
              ...object,
              outline: {
                source: {
                  sections: object.outline?.sections,
                },
              },
            } as T,
          }
        }

        return {
          object: object as T,
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/source.md', 'Explain provider schema recovery.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })

    expect(returnedSourceOutline).to.equal(true)
    expect(plan.outline.sections.map((section) => ({
      goal: section.goal,
      title: section.title,
    }))).to.deep.equal(rawPlan.outline.sections)
  })

  it('normalizes LLM-authored slide transition aliases after generation', async () => {
    const rawPlan = withDeckTransitions({
      language: 'en-US',
      outline: deckOutline(2),
      slides: [
        {
          duration: 4,
          motion: 'fade-in',
          points: ['First transition'],
          semantic: deckSemantic('First slide uses a provider transition alias.'),
          sourceRange: [0, 4],
          speakerNote: 'Explain the first slide transition.',
          title: 'First',
          transitionOut: {duration: 0.5, type: 'crossfade'},
          type: 'summary',
          visual: deckVisual('text'),
        },
        {
          duration: 4,
          motion: 'soft-scale',
          points: ['Second slide'],
          semantic: deckSemantic('Second slide completes the transition test.'),
          sourceRange: [4, 8],
          speakerNote: 'Explain the second slide.',
          title: 'Second',
          transitionOut: null,
          type: 'summary',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Transition aliases are normalized after LLM generation.',
      targetPlatform: 'generic',
      theme: 'elegant-dark',
      title: 'Transition Alias',
    })
    let returnedTransitionAlias = false
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        const object = stagedDeckObjectForRequest(request, rawPlan) as {
          slides?: Array<{transitionOut?: {duration: number; type: string} | null}>
        }

        if (requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan') {
          returnedTransitionAlias = true

          return {
            object: {
              ...object,
              slides: object.slides?.map((slide, index) => index === 0
                ? {...slide, motion: 'fade', transitionOut: {duration: 0.5, type: 'wipe'}}
                : slide),
            } as T,
          }
        }

        return {
          object: object as T,
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/source.md', 'Explain provider transition aliases.', {
      deckFormat: 'landscape_1920x1080',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      slideCountTarget: 2,
      sourceType: 'markdown',
    })

    expect(returnedTransitionAlias).to.equal(true)
    expect(plan.deck.slides[0]?.motion).to.equal('fade-in')
    expect(plan.deck.slides[0]?.transitionOut).to.deep.equal({duration: 0.5, type: 'fade'})
  })

  it('normalizes LLM-authored chart value scales after generation', async () => {
    const rawPlan = createOneSlideRawPlan([0, 8])
    let returnedScaledChart = false
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        const object = stagedDeckObjectForRequest(request, rawPlan) as {
          slides?: Array<Record<string, unknown>>
        }

        if (requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan') {
          returnedScaledChart = true

          return {
            object: {
              ...object,
              slides: object.slides?.map((slide) => ({
                ...slide,
                chart: {
                  bars: [
                    {label: 'One to five', value: 5},
                    {label: 'Percent', value: 80},
                    {label: 'Ratio', value: 0.4},
                  ],
                },
                points: [],
                type: 'chart',
                visual: deckVisual('chart'),
              })),
            } as T,
          }
        }

        return {
          object: object as T,
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/source.md', 'Explain provider chart value scales.', {
      deckFormat: 'landscape_1920x1080',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })

    expect(returnedScaledChart).to.equal(true)
    expect(plan.deck.slides[0]?.chart?.bars.map((bar) => bar.value)).to.deep.equal([1, 0.8, 0.4])
  })

  it('retries schema-boundary object failures with explicit Deck repair feedback', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const rawPlan = createOneSlideRawPlan()
    let failedContentAnalysis = false
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request as GenerateObjectRequest<unknown>) === 'content-analysis' && !failedContentAnalysis) {
          failedContentAnalysis = true
          throw new Error('No object generated: response did not match schema.')
        }

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

    await createLLMTextDeckProjectPlan(llm, '/tmp/source.md', 'Explain provider certification.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })

    const contentAnalysisRequests = requests.filter((request) => requestStage(request) === 'content-analysis')
    const retryMessage = contentAnalysisRequests[1]?.messages?.at(-1)
    const retryPayload = JSON.parse(typeof retryMessage?.content === 'string' ? retryMessage.content : '{}') as {
      goal?: string
      instructions?: string[]
      validationError?: string
    }

    expect(contentAnalysisRequests).to.have.length(2)
    expect(retryPayload.validationError).to.include('No object generated')
    expect(retryPayload.goal).to.include('matches the requested structured schema exactly')
    expect(retryPayload.instructions?.join('\n')).to.include('Do not wrap the response in analysis')
    expect(retryPayload.instructions?.join('\n')).to.include('Do not return an object from a prior stage')
    expect(retryPayload.instructions?.join('\n')).to.include('Do not return feedback fields from this repair prompt')
    expect(retryPayload.instructions?.join('\n')).to.include('sections[].keyClaims')
    expect(retryPayload.instructions?.join('\n')).to.include('use only crossfade, fade, slide-left, or slide-up')
  })

  it('includes a strict content-analysis output contract in the prompt payload', () => {
    const sourceMap = createDeckSourceMap({
      inputPath: '/tmp/source.md',
      language: 'zh-CN',
      sourceType: 'markdown',
      text: '# Serenity Alpha\n\nExplain the workflow.',
    })
    const request = createContentAnalysisRequest(
      '/tmp/source.md',
      {
        chunkId: 'text-001',
        text: '# Serenity Alpha\n\nExplain the workflow.',
      },
      sourceMap,
      {
        deckFormat: 'landscape_1920x1080',
        durationTargetSeconds: 30,
        language: 'zh-CN',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )
    const payload = requestPayload(request) as {
      instructions?: string[]
      outputContract?: {
        section?: {forbiddenFieldNames?: string[]; required?: string[]}
        sectionShape?: {keyClaims?: Array<Record<string, unknown>>; summary?: string; title?: string}
      }
    }

    expect(payload.instructions?.join('\n')).to.include('Follow outputContract exactly')
    expect(request.schemaDescription).to.include('Every sections[] item must contain id, importance, keyClaims')
    expect(payload.outputContract?.section?.required).to.deep.equal(['id', 'importance', 'keyClaims', 'mustCover', 'role', 'summary', 'title'])
    expect(payload.outputContract?.section?.forbiddenFieldNames).to.include('analysis')
    expect(payload.outputContract?.sectionShape?.summary).to.include('do not use analysis')
    expect(payload.outputContract?.sectionShape?.title).to.include('do not use heading')
    expect(payload.outputContract?.sectionShape?.keyClaims?.[0]).to.deep.equal({
      confidence: 'number from 0 to 1',
      sourceQuoteText: 'non-empty source-grounded quote or short source excerpt',
      text: 'non-empty claim text',
      type: 'one of: claim, data, recommendation, summary',
    })
  })

  it('includes a strict deck-brief output contract in the prompt payload', () => {
    const request = createDeckBriefRequest('/tmp/source.md', {
      language: 'zh-CN',
      sections: [
        {
          id: 'source-section-001',
          importance: 0.9,
          keyClaims: [{
            confidence: 0.9,
            sourceQuoteText: 'Observable demand matters.',
            text: '需求变化是核心。',
            type: 'claim',
          }],
          mustCover: true,
          role: '核心原则',
          summary: '解释核心原则。',
          title: '核心原则',
        },
      ],
      summary: 'Serenity Alpha summary.',
      title: 'Serenity Alpha',
    }, {
      deckFormat: 'landscape_1920x1080',
      durationTargetSeconds: 30,
      language: 'zh-CN',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const payload = requestPayload(request) as {
      instructions?: string[]
      outputContract?: {
        forbiddenRootFieldNames?: string[]
        root?: {required?: string[]}
        rootShape?: {narrativeArc?: unknown; optionalSectionIds?: unknown; requiredSectionIds?: unknown}
      }
    }

    expect(request.schemaDescription).to.include('Do not return sections, slides, slidePlan, output, deckBrief')
    expect(payload.instructions?.join('\n')).to.include('Follow outputContract exactly')
    expect(payload.outputContract?.forbiddenRootFieldNames).to.include('output')
    expect(payload.outputContract?.forbiddenRootFieldNames).to.include('slidePlan')
    expect(payload.outputContract?.root?.required).to.deep.equal([
      'densityPolicy',
      'language',
      'narrativeArc',
      'objective',
      'optionalSectionIds',
      'requiredSectionIds',
      'styleIntent',
      'targetDurationSeconds',
      'targetSlideCount',
      'title',
    ])
    expect(payload.outputContract?.rootShape?.narrativeArc).to.deep.equal(['array of one or more non-empty strings; do not return one paragraph string'])
    expect(payload.outputContract?.rootShape?.optionalSectionIds).to.deep.equal(['array of source section ids that may be omitted; use [] when none'])
    expect(payload.outputContract?.rootShape?.requiredSectionIds).to.deep.equal(['array of must-cover analysis.sections ids; preserve ids exactly'])
  })

  it('sends all template validation issues to a cached slide-plan rewrite request', async () => {
    const invalidPlan = createOneSlideRawPlan()
    const fixedPlan = createOneSlideRawPlan()
    invalidPlan.slides[0] = {
      ...invalidPlan.slides[0],
      points: [
        'Demand-driven alpha identification workflow',
        'Structured workflow and validation template',
      ],
      semantic: deckSemantic('Summarize alpha identification and workflow.'),
      speakerNote: 'Summarize alpha identification and workflow.',
      title: 'Key Takeaways',
    }
    fixedPlan.slides[0] = {
      ...fixedPlan.slides[0],
      points: [
        'Demand-led alpha',
        'Structured workflow',
      ],
      semantic: deckSemantic('Summarize alpha identification and workflow.'),
      speakerNote: 'Summarize alpha identification and workflow.',
      title: 'Key Takeaways',
    }

    let useFixedPlan = false
    let capturedRewriteRequest: GenerateObjectRequest<unknown> | undefined
    let capturedIssues: unknown[] = []
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        const stage = requestStage(request as GenerateObjectRequest<unknown>)
        const isRewrite = (request.messages?.length ?? 0) > 1

        if (stage === 'slide-plan' && isRewrite) {
          capturedRewriteRequest = request as GenerateObjectRequest<unknown>
          const feedback = JSON.parse(String(request.messages?.[2]?.content ?? '{}')) as {issues?: unknown[]}
          capturedIssues = feedback.issues ?? []
          useFixedPlan = true
        }

        return {
          object: stagedDeckObjectForRequest(request, useFixedPlan ? fixedPlan : invalidPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/source.md', 'Explain alpha workflow.', {
      deckFormat: 'landscape_1920x1080',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })

    expect(plan.deck.slides[0]?.points).to.deep.equal(['Demand-led alpha', 'Structured workflow'])
    expect(capturedIssues).to.have.length(2)
    expect(capturedIssues[0]).to.deep.include({
      actual: 43,
      code: 'TEMPLATE_TEXT_LENGTH_LIMIT',
      field: 'point 1',
      limit: 40,
      message: 'LLM Deck plan slide "Key Takeaways" point 1 has 43 characters, exceeding summary limit 40. Rewrite the slide in LLM output.',
      path: 'slides[0].points[0]',
      slideIndex: 0,
      slideTitle: 'Key Takeaways',
      stage: 'slide-plan',
      template: 'summary',
    })
    expect(capturedIssues[0]).to.deep.include({
      repairStrategy: 'satisfyValidation',
      repeatCount: 1,
    })
    expect(capturedIssues[1]).to.deep.include({
      actual: 43,
      code: 'TEMPLATE_TEXT_LENGTH_LIMIT',
      field: 'point 2',
      limit: 40,
      message: 'LLM Deck plan slide "Key Takeaways" point 2 has 43 characters, exceeding summary limit 40. Rewrite the slide in LLM output.',
      path: 'slides[0].points[1]',
      slideIndex: 0,
      slideTitle: 'Key Takeaways',
      stage: 'slide-plan',
      template: 'summary',
    })
    const rewritePayload = JSON.parse(String(capturedRewriteRequest?.messages?.[2]?.content ?? '{}')) as {instructions?: string[]}

    expect(rewritePayload.instructions?.join('\n')).to.include('Return only the replacement slide-plan object')
    expect(rewritePayload.instructions?.join('\n')).to.include('Do not wrap the response in invalidOutput')
    expect(capturedRewriteRequest?.cache).to.deep.include({
      messageIndex: 0,
      mode: 'ephemeral',
    })
    expect(capturedRewriteRequest?.cache?.key).to.match(/^deck:slide-plan:[a-f0-9]{24}$/u)
  })

  it('asks the LLM to rewrite slide outlines that miss required source coverage', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const rawPlan = withDeckTransitions({
      language: 'en-US',
      outline: deckOutline(2),
      slides: [
        {
          duration: 6,
          motion: 'soft-scale',
          points: ['Coverage map'],
          semantic: deckSemantic('Source coverage is explicit.'),
          sourceRange: [0, 6],
          speakerNote: 'Source coverage is explicit.',
          title: 'Coverage',
          type: 'summary',
          visual: deckVisual('text'),
        },
        {
          duration: 6,
          motion: 'soft-scale',
          points: ['Repair loop'],
          semantic: deckSemantic('Outline repair keeps required sections visible.'),
          sourceRange: [6, 12],
          speakerNote: 'Outline repair keeps required sections visible.',
          title: 'Repair',
          type: 'summary',
          visual: deckVisual('text'),
        },
      ],
      summary: 'Coverage and repair keep deck planning source-grounded.',
      targetPlatform: 'generic',
      theme: 'clean-white',
      title: 'Coverage Repair',
    })
    let slideOutlineCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request) === 'slide-outline') {
          slideOutlineCalls += 1

          if (slideOutlineCalls === 1) {
            return {
              object: {
                slides: rawPlan.slides.map((slide, index) => ({
                  goal: index === 0 ? 'Explain only the first required section.' : 'Repeat the first required section.',
                  informationRole: 'claim',
                  mustCover: true,
                  narrationBudgetSeconds: slide.duration,
                  outlineId: `outline-${String(index + 1).padStart(3, '0')}`,
                  sourceSectionIds: ['section-001'],
                  templateIntent: slide.type,
                  visualIntent: 'text',
                })),
              } as T,
            }
          }
        }

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

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/coverage.md', 'Coverage first.\n\nRepair second.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 12,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const rewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-outline' && (request.messages?.length ?? 0) > 1)
    const rewritePayload = JSON.parse(String(rewriteRequest?.messages?.at(-1)?.content ?? '{}')) as {
      instructions: string[]
      issues: Array<{code: string; path?: string; stage: string}>
    }

    expect(slideOutlineCalls).to.equal(2)
    expect(rewritePayload.issues[0]).to.deep.include({
      code: 'SOURCE_COVERAGE',
      path: 'slideOutline.slides[].sourceSectionIds',
      stage: 'slide-outline',
    })
    expect(rewritePayload.instructions.join('\n')).to.include('Every brief.requiredSectionIds entry')
    expect(plan.coverageReport.summary.errors).to.equal(0)
    expect(plan.slideOutline.slides.flatMap((slide) => slide.sourceSectionIds)).to.include('section-002')
  })

  it('asks the LLM to rewrite script semantics when speaker notes exceed timing preflight', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const invalidPlan = createOneSlideRawPlan()
    invalidPlan.slides[0] = {
      ...invalidPlan.slides[0],
      duration: 4,
      sourceRange: [0, 4],
      speakerNote: 'Provider certification requires stable failure clarity, cost visibility, retry stability, trace coverage, artifact evidence, operator review discipline, repeatable regression checks, and explicit release readiness evidence.',
    }
    const fixedPlan = createOneSlideRawPlan()
    fixedPlan.slides[0] = {
      ...fixedPlan.slides[0],
      duration: 4,
      sourceRange: [0, 4],
      speakerNote: 'Provider certification keeps traces auditable.',
    }
    let scriptSemanticsCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request) === 'script-semantics') {
          scriptSemanticsCalls += 1
          return {
            object: stagedDeckObjectForRequest(request, scriptSemanticsCalls === 1 ? invalidPlan : fixedPlan),
          }
        }

        return {
          object: stagedDeckObjectForRequest(request, invalidPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/script-timing.md', 'Provider certification keeps traces auditable.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 4,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const rewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics' && (request.messages?.length ?? 0) > 1)
    const rewritePayload = JSON.parse(String(rewriteRequest?.messages?.at(-1)?.content ?? '{}')) as {
      issues: Array<{code: string; field?: string; path?: string; stage: string}>
    }

    expect(scriptSemanticsCalls).to.equal(2)
    expect(rewritePayload.issues[0]).to.deep.include({
      code: 'SCRIPT_TIMING_TOTAL_BUDGET',
      field: 'speakerNote',
      path: 'scriptSemantics.slides[].speakerNote',
      stage: 'script-semantics',
    })
    expect(plan.speakerScript.segments[0]?.text).to.equal('Provider certification keeps traces auditable.')
    expect(plan.scriptTimingReport.summary.errors).to.equal(0)
  })

  it('asks the LLM to rewrite script semantics when slide entries are missing before final assembly', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const rawPlan = withDeckTransitions({
      language: 'en-US',
      outline: deckOutline(2),
      slides: [
        {
          duration: 4,
          motion: 'soft-scale' as const,
          points: ['First step'],
          semantic: deckSemantic('First step keeps planning grounded.'),
          sourceRange: [0, 4] as [number, number],
          speakerNote: 'Explain the first grounded planning step.',
          title: 'First Step',
          transitionOut: {duration: 0.55, type: 'crossfade' as const},
          type: 'summary' as const,
          visual: deckVisual('text'),
        },
        {
          duration: 4,
          motion: 'soft-scale' as const,
          points: ['Second step'],
          semantic: deckSemantic('Second step closes the validation loop.'),
          sourceRange: [4, 8] as [number, number],
          speakerNote: 'Explain how the second step closes the validation loop.',
          title: 'Second Step',
          transitionOut: null,
          type: 'summary' as const,
          visual: deckVisual('text'),
        },
      ],
      summary: 'Two steps keep validation grounded.',
      targetPlatform: 'generic' as const,
      theme: 'elegant-dark' as const,
      title: 'Two Step Plan',
    })
    let scriptSemanticsCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request) === 'script-semantics') {
          scriptSemanticsCalls += 1
          const scriptSemantics = stagedDeckObjectForRequest(request, rawPlan) as {
            outline: ReturnType<typeof deckOutline>
            slides: unknown[]
          }

          if (scriptSemanticsCalls === 1) {
            return {
              object: {
                ...scriptSemantics,
                outline: deckOutline(1),
                slides: scriptSemantics.slides.slice(0, 1),
              } as T,
            }
          }

          return {
            object: scriptSemantics as T,
          }
        }

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

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/script-cardinality.md', 'Explain two validation steps.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const rewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics' && (request.messages?.length ?? 0) > 1)
    const rewritePayload = JSON.parse(String(rewriteRequest?.messages?.at(-1)?.content ?? '{}')) as {
      issues: Array<{code: string; path?: string; stage: string}>
    }

    expect(scriptSemanticsCalls).to.equal(2)
    expect(rewritePayload.issues[0]).to.deep.include({
      code: 'SCRIPT_SEMANTICS_CARDINALITY',
      path: 'scriptSemantics.slides',
      stage: 'script-semantics',
    })
    expect(plan.deck.slides).to.have.length(2)
    expect(plan.scriptTimingReport.summary.errors).to.equal(0)
  })

  it('asks the LLM to rewrite slide plan when slide-plan entries are missing before final assembly', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const rawPlan = withDeckTransitions({
      language: 'en-US',
      outline: deckOutline(2),
      slides: [
        {
          duration: 4,
          motion: 'soft-scale' as const,
          points: ['First step'],
          semantic: deckSemantic('First step keeps planning grounded.'),
          sourceRange: [0, 4] as [number, number],
          speakerNote: 'Explain the first grounded planning step.',
          title: 'First Step',
          transitionOut: {duration: 0.55, type: 'crossfade' as const},
          type: 'summary' as const,
          visual: deckVisual('text'),
        },
        {
          duration: 4,
          motion: 'soft-scale' as const,
          points: ['Second step'],
          semantic: deckSemantic('Second step closes the validation loop.'),
          sourceRange: [4, 8] as [number, number],
          speakerNote: 'Explain how the second step closes the validation loop.',
          title: 'Second Step',
          transitionOut: null,
          type: 'summary' as const,
          visual: deckVisual('text'),
        },
      ],
      summary: 'Two steps keep validation grounded.',
      targetPlatform: 'generic' as const,
      theme: 'elegant-dark' as const,
      title: 'Two Step Plan',
    })
    let slidePlanCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request) === 'slide-plan') {
          slidePlanCalls += 1
          const slidePlan = stagedDeckObjectForRequest(request, rawPlan) as {
            slides: unknown[]
          }

          if (slidePlanCalls === 1) {
            return {
              object: {
                ...slidePlan,
                slides: slidePlan.slides.slice(0, 1),
              } as T,
            }
          }
        }

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

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/slide-plan-cardinality.md', 'Explain two validation steps.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const rewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan' && (request.messages?.length ?? 0) > 1)
    const rewritePayload = JSON.parse(String(rewriteRequest?.messages?.at(-1)?.content ?? '{}')) as {
      issues: Array<{code: string; path?: string; stage: string}>
    }

    expect(slidePlanCalls).to.equal(2)
    expect(rewritePayload.issues[0]).to.deep.include({
      code: 'SLIDE_PLAN_CARDINALITY',
      path: 'slidePlan.slides',
      stage: 'slide-plan',
    })
    expect(plan.deck.slides).to.have.length(2)
    expect(plan.scriptTimingReport.summary.errors).to.equal(0)
  })

  it('keeps low-depth coherence warnings in the report without forcing a rewrite', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const weakPlan = createOneSlideRawPlan()
    weakPlan.slides[0] = {
      ...weakPlan.slides[0],
      points: ['Generic summary'],
      title: 'Generic Summary',
      type: 'summary',
    }
    let coherenceCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)
        const stage = requestStage(request as GenerateObjectRequest<unknown>)

        if (stage === 'coherence-review') {
          coherenceCalls += 1

          if (coherenceCalls === 1) {
            return {
              object: {
                issues: [
                  {
                    code: 'LOW_INFORMATION_DEPTH',
                    message: 'The slide compresses an actionable workflow into a generic summary.',
                    path: 'slidePlan.slides[0]',
                    severity: 'warning',
                    slideIndex: 0,
                    stage: 'slide-plan',
                  },
                ],
                summary: 'The deck needs a more actionable slide plan.',
              } as T,
            }
          }

          return {
            object: {
              issues: [],
              summary: 'The rewritten deck is coherent.',
            } as T,
          }
        }

        return {
          object: stagedDeckObjectForRequest(request, weakPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/coherence.md', 'Convert the workflow into actionable validation steps.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const rewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan' && (request.messages?.length ?? 0) > 1)

    expect(coherenceCalls).to.equal(1)
    expect(rewriteRequest).to.equal(undefined)
    expect(plan.deck.slides[0]?.title).to.equal('Generic Summary')
    expect(plan.coherenceReport.summary.errors).to.equal(0)
    expect(plan.coherenceReport.summary.warnings).to.equal(1)
  })

  it('does not let later coherence reviews upgrade the same warning into a blocking error', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const rawPlan = createOneSlideRawPlan()
    let coherenceCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request as GenerateObjectRequest<unknown>) === 'coherence-review') {
          coherenceCalls += 1

          if (coherenceCalls === 1) {
            return {
              object: {
                issues: [
                  {
                    code: 'LOW_INFORMATION_DEPTH',
                    message: 'The slide could include one more practical detail, but it remains reviewable.',
                    path: 'slides[0]',
                    severity: 'warning',
                    slideIndex: 0,
                    stage: 'slide-plan',
                  },
                  {
                    code: 'COHERENCE_GAP',
                    message: 'The narration needs a clearer bridge from the visible point to the conclusion.',
                    path: 'scriptSemantics.slides[0].speakerNote',
                    severity: 'error',
                    slideIndex: 0,
                    stage: 'script-semantics',
                  },
                ],
                summary: 'One warning and one script issue.',
              } as T,
            }
          }

          return {
            object: {
              issues: [
                {
                  code: 'LOW_INFORMATION_DEPTH',
                  message: 'The same slide detail concern is now reported too strongly.',
                  path: 'slides[0]',
                  severity: 'error',
                  slideIndex: 0,
                  stage: 'slide-plan',
                },
              ],
              summary: 'The prior warning should remain non-blocking.',
            } as T,
          }
        }

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

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/coherence-warning-stability.md', 'Explain warning stability.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 8,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })

    expect(coherenceCalls).to.equal(2)
    expect(plan.coherenceReport.summary.errors).to.equal(0)
    expect(plan.coherenceReport.summary.warnings).to.equal(1)
  })

  it('sends scoring scale requirements to slide-plan repairs after coherence feedback', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const weakPlan = createOneSlideRawPlan()
    weakPlan.language = 'zh-CN'
    weakPlan.slides[0] = {
      ...weakPlan.slides[0],
      points: ['步骤6：评分维度包括需求确定性、证据强度、弹性'],
      semantic: deckSemantic('评分步骤需要可见的1-5标尺与评分维度。'),
      speakerNote: '解释评分步骤。',
      title: '步骤详解：评估与决策',
      type: 'three-points',
    }
    const fixedPlan = {
      ...weakPlan,
      slides: weakPlan.slides.map((slide) => ({
        ...slide,
        points: [
          '1弱/5强：逐项给7维度打分',
          '维度：确定性、传导、纯度、弹性',
          '高分优先验证；低分观察或放弃',
        ],
      })),
    }
    let coherenceCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)
        const stage = requestStage(request as GenerateObjectRequest<unknown>)

        if (stage === 'coherence-review') {
          coherenceCalls += 1

          return {
            object: coherenceCalls === 1
              ? {
                  issues: [{
                    code: 'MISSING_PRACTICAL_DETAIL',
                    message: 'Visible text for the scoring step lacks actionable details such as the 1-5 scale or specific criteria for assigning scores.',
                    path: 'slides[0].points[0]',
                    severity: 'error',
                    slideIndex: 0,
                    stage: 'slide-plan',
                  }],
                  summary: 'The scoring slide needs actionable visible detail.',
                }
              : {
                  issues: [],
                  summary: 'The rewritten scoring slide is actionable.',
                } as T,
          }
        }

        return {
          object: stagedDeckObjectForRequest(request, stage === 'slide-plan' && (request.messages?.length ?? 0) > 1 ? fixedPlan : weakPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/scoring.md', 'Score each candidate qualitatively or on a 1-5 scale.', {
      deckFormat: 'landscape_1920x1080',
      durationTargetSeconds: 8,
      language: 'zh-CN',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const slidePlanRewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan' && (request.messages?.length ?? 0) > 1)
    const rewritePayload = JSON.parse(String(slidePlanRewriteRequest?.messages?.at(-1)?.content ?? '{}')) as {
      instructions: string[]
      issues: Array<{requiredAdditions?: string[]; repairStrategy?: string}>
    }

    expect(coherenceCalls).to.equal(2)
    expect(rewritePayload.instructions.join('\n')).to.include('score scale meaning')
    expect(rewritePayload.instructions.join('\n')).to.include('score-band or evidence-state mapping')
    expect(rewritePayload.issues[0]?.requiredAdditions?.join('\n')).to.include('score scale meaning')
    expect(plan.deck.slides[0]?.points).to.deep.equal(fixedPlan.slides[0]?.points)
  })

  it('escalates repeated script-semantics coherence failures to slide-plan repair contracts', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const weakPlan = createOneSlideRawPlan()
    weakPlan.slides[0] = {
      ...weakPlan.slides[0],
      duration: 12,
      points: ['Alpha formula'],
      speakerNote: 'Alpha elasticity compares demand impact with company scale.',
      sourceRange: [0, 12],
      title: 'Alpha Elasticity',
      type: 'one-big-idea',
    }
    const fixedPlan = createOneSlideRawPlan()
    fixedPlan.slides[0] = {
      ...fixedPlan.slides[0],
      duration: 12,
      points: ['Estimate demand impact', 'Check revenue purity', 'Compare to company scale'],
      speakerNote: 'Estimate incremental demand through orders, ASP, shipment volume, or customer adoption. Then check revenue purity through segment revenue, customer concentration, and product exposure before comparing impact with company scale.',
      sourceRange: [0, 12],
      title: 'Alpha Elasticity Test',
      type: 'three-points',
    }
    let coherenceCalls = 0
    let useFixedPlan = false

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)
        const stage = requestStage(request as GenerateObjectRequest<unknown>)

        if (stage === 'coherence-review') {
          coherenceCalls += 1

          if (coherenceCalls <= 2) {
            return {
              object: {
                issues: [
                  {
                    code: 'LOW_INFORMATION_DEPTH',
                    message: 'The slide names alpha elasticity but does not explain how to estimate incremental demand impact or business purity.',
                    path: 'scriptSemantics.slides[0].semantic',
                    severity: 'error',
                    slideIndex: 0,
                    stage: 'script-semantics',
                  },
                ],
                summary: 'The alpha elasticity explanation is still not operational.',
              } as T,
            }
          }

          return {
            object: {
              issues: [],
              summary: 'The repaired slide is operational.',
            } as T,
          }
        }

        if (stage === 'slide-plan' && (request.messages?.length ?? 0) > 1) {
          useFixedPlan = true
        }

        return {
          object: stagedDeckObjectForRequest(request, useFixedPlan ? fixedPlan : weakPlan),
        }
      },
      async generateText(_request: GenerateTextRequest) {
        throw new Error('generateText is not used by this test.')
      },
      streamText(_request: StreamTextRequest): AsyncIterable<LLMEvent> {
        throw new Error('streamText is not used by this test.')
      },
    }

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/coherence-escalation.md', 'Explain alpha elasticity as an operational screen.', {
      deckFormat: 'portrait_1080x1920',
      durationTargetSeconds: 12,
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const scriptRewriteRequests = requests.filter((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics' && (request.messages?.length ?? 0) > 1)
    const slidePlanRewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'slide-plan' && (request.messages?.length ?? 0) > 1)
    const coherencePayloads = requests
      .filter((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'coherence-review')
      .map((request) => requestPayload(request as GenerateObjectRequest<unknown>) as {
        instructions: string[]
        previousIssues: Array<{code: string; message: string; stage: string}>
      })
    const rewritePayload = JSON.parse(String(slidePlanRewriteRequest?.messages?.at(-1)?.content ?? '{}')) as {
      issues: Array<{
        code: string
        escalationReason?: string
        forbiddenFixes?: string[]
        repairStrategy?: string
        repeatCount?: number
        requiredAdditions?: string[]
        stage: string
      }>
    }

    expect(coherenceCalls).to.equal(3)
    expect(coherencePayloads[0]?.previousIssues).to.deep.equal([])
    expect(coherencePayloads[1]?.instructions.join('\n')).to.include('Use previousIssues')
    expect(coherencePayloads[1]?.previousIssues[0]).to.deep.include({
      code: 'LOW_INFORMATION_DEPTH',
      stage: 'script-semantics',
    })
    expect(scriptRewriteRequests).to.have.length(1)
    expect(rewritePayload.issues[0]).to.deep.include({
      code: 'LOW_INFORMATION_DEPTH',
      repairStrategy: 'requireOperationalCriteria',
      repeatCount: 2,
      stage: 'slide-plan',
    })
    expect(rewritePayload.issues[0]?.requiredAdditions?.join('\n')).to.include('source-grounded way to estimate')
    expect(rewritePayload.issues[0]?.forbiddenFixes?.join('\n')).to.include('Do not only restate')
    expect(rewritePayload.issues[0]?.escalationReason).to.include('survived 2 rewrite attempt')
    expect(plan.deck.slides[0]?.title).to.equal('Alpha Elasticity Test')
  })

  it('does not rewrite when coherence only reports global target duration shortfall', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const rawPlan = createOneSlideRawPlan()
    let coherenceCalls = 0

    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request as GenerateObjectRequest<unknown>) === 'coherence-review') {
          coherenceCalls += 1

          return {
            object: {
              issues: [
                {
                  code: 'TIMING_BUDGET_MISMATCH',
                  message: 'Total narration budget is below target durationSeconds; this may produce a shorter video.',
                  path: 'scriptSemantics.outline, brief.targetDurationSeconds',
                  severity: 'error',
                  stage: 'slide-outline',
                },
              ],
              summary: 'Only global duration shortfall was found.',
            } as T,
          }
        }

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

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/global-duration.md', 'Keep the deck concise.', {
      deckFormat: 'portrait_1080x1920',
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })
    const rewriteRequests = requests.filter((request) => (request.messages?.length ?? 0) > 1)

    expect(coherenceCalls).to.equal(1)
    expect(rewriteRequests).to.have.length(0)
    expect(plan.coherenceReport.summary.errors).to.equal(0)
    expect(plan.coherenceReport.summary.warnings).to.equal(1)
  })

  it('preserves LLM-inferred brief target duration when the user did not request one', async () => {
    const rawPlan = createOneSlideRawPlan()
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        if (requestStage(request as GenerateObjectRequest<unknown>) === 'deck-brief') {
          return {
            object: {
              ...(stagedDeckObjectForRequest(request, rawPlan) as object),
              targetDurationSeconds: 8,
            } as T,
          }
        }

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

    const plan = await createLLMTextDeckProjectPlan(llm, '/tmp/inferred-duration.md', 'Keep the deck concise.', {
      deckFormat: 'portrait_1080x1920',
      language: 'en-US',
      maxSlideCharacters: 260,
      sourceType: 'markdown',
    })

    expect(plan.deckBrief.targetDurationSeconds).to.equal(8)
    expect(plan.mediaInfo.duration).to.equal(8)
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

  it('rejects direct artifact planning without staged LLM artifacts instead of deriving them from rawPlan', () => {
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
        sourceType: 'markdown',
      },
    )).to.throw('no semantic source map fallback is allowed')
  })

  it('asks the LLM to preserve source code examples as code slides', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        const rawPlan = withDeckTransitions({
            language: 'en-US',
            outline: deckOutline(4),
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
	                duration: 20,
                motion: 'blur-rise',
	                points: ['Apply a Pod manifest with kubectl.'],
	                semantic: deckSemantic('Apply a Pod manifest with kubectl.', 'example'),
		                sourceRange: [30, 50],
	                speakerNote: 'This command applies the example Pod manifest with kubectl.',
                title: 'Create a Pod',
                type: 'code',
                visual: deckVisual('code'),
              },
              {
                duration: 20,
                motion: 'stagger-up',
                points: [],
                process: {
                  steps: [
                    {detail: 'Write the Pod YAML with the workload fields.', label: 'Define manifest'},
                    {detail: 'Run the kubectl apply command from the code slide.', label: 'Apply with kubectl'},
                    {detail: 'Move ongoing management to Deployment or Job controllers.', label: 'Use controllers'},
                  ],
                },
                semantic: deckSemantic('Create Pods from manifests, then manage them through workload controllers.', 'recommendation'),
                sourceRange: [50, 70],
                speakerNote: 'The workflow is to define the manifest, apply it with kubectl, and rely on controllers for ongoing management.',
                title: 'Pod Workflow',
                type: 'process',
                visual: deckVisual('process'),
              },
              {
	                duration: 20,
                motion: 'soft-scale',
	                points: ['Use workload controllers'],
	                semantic: deckSemantic('Use workload resources for ongoing management.', 'summary'),
		                sourceRange: [70, 90],
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
    const scriptSemanticsRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics')
    const coherenceReviewRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'coherence-review')
    const message = slidePlanRequest?.messages?.[0]
    const scriptMessage = scriptSemanticsRequest?.messages?.[0]
    const coherenceMessage = coherenceReviewRequest?.messages?.[0]
    const payload = JSON.parse(typeof message?.content === 'string' ? message.content : '') as {
      instructions: string[]
      target: {
        requiredSlideTypes?: string[]
        slideCount: {maximum: number; minimum: number; policy: string; target?: number}
        speakerNoteCharactersPerSlide?: unknown
        speakerNotePlanning: {policy: string}
      }
    }
    const scriptPayload = JSON.parse(typeof scriptMessage?.content === 'string' ? scriptMessage.content : '') as {
      instructions: string[]
      scriptTimingBudgets: Array<{budgetSeconds: number; slideIndex: number; suggestedSpeakerNoteWords?: number}>
    }
    const coherencePayload = JSON.parse(typeof coherenceMessage?.content === 'string' ? coherenceMessage.content : '') as {
      instructions: string[]
    }

    expect(plan.deck.slides.map((slide) => slide.type)).to.include('code')
    expect(payload.instructions.join('\n')).to.include('code_sample references')
    expect(payload.instructions.join('\n')).to.include('include at least one code slide')
    expect(payload.instructions.join('\n')).to.include('preserve the executable command')
    expect(payload.instructions.join('\n')).to.include('visible fields must carry the operational method')
    expect(payload.instructions.join('\n')).to.include('process.steps')
    expect(payload.instructions.join('\n')).to.include('Do not hide practical detail only in speakerNote')
    expect(payload.instructions.join('\n')).to.include('verification-chain slides')
    expect(payload.instructions.join('\n')).to.include('score band to next action')
    expect(payload.instructions.join('\n')).to.include('replace placeholders with short filled examples')
    expect(payload.instructions.join('\n')).to.include('end with a summary slide')
    expect(payload.instructions.join('\n')).to.include('Preserve the slideOutline slide count exactly')
    expect(coherencePayload.instructions.join('\n')).to.include('enumerate every slide-plan visible-text')
    expect(coherencePayload.instructions.join('\n')).to.include('Do not hold similar practical-detail issues for later review rounds')
    expect(coherencePayload.instructions.join('\n')).to.include('appears only in speakerNote')
    expect(coherencePayload.instructions.join('\n')).to.include('review process.steps as the visible flowchart content')
    expect(plan.deck.slides.find((slide) => slide.type === 'process')?.process?.steps).to.have.length(3)
    expect(payload.target.requiredSlideTypes).to.deep.equal(['hero', 'process', 'code', 'summary'])
    expect(payload.target.slideCount).to.deep.include({maximum: 24, minimum: 4})
    expect(payload.target.slideCount.target).to.equal(4)
    expect(payload.target.speakerNoteCharactersPerSlide).to.equal(undefined)
    expect(payload.target.speakerNotePlanning.policy).to.include('whole deck duration')
    expect(scriptPayload.instructions.join('\n')).to.include('pacing guidance, not per-slide hard limits')
    expect(scriptPayload.scriptTimingBudgets[0]).to.deep.include({
      budgetSeconds: 30,
      slideIndex: 0,
      suggestedSpeakerNoteWords: 78,
    })
  })

  it('rewrites over-budget script semantics with aggregate timing feedback', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    let coherenceCalls = 0
    let scriptCalls = 0
    const overBudgetNote = '这段旁白故意写得非常长，需要通过脚本语义重写来压缩表达，否则整体旁白估算时长会超过目标时长很多，并让后续一致性检查反复失败。'.repeat(2)
    const shortNote = '说明整体节奏如何让旁白按时完成。'
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request) === 'script-semantics') {
          scriptCalls += 1
        }

        if (requestStage(request) === 'coherence-review') {
          coherenceCalls += 1

          return {
            object: {
              issues: [],
              summary: 'The deck is coherent enough for artifact build.',
            } as T,
          }
        }

        const rawPlan = withDeckTransitions({
          language: 'zh-CN',
          outline: deckOutline(),
          slides: [
            {
              duration: 12,
              motion: 'soft-scale',
              points: ['预算反馈'],
              semantic: deckSemantic('旁白预算反馈需要明确。'),
              sourceRange: [0, 12],
              speakerNote: scriptCalls < 2 ? overBudgetNote : shortNote,
              title: '预算反馈',
              type: 'summary',
              visual: deckVisual('text'),
            },
          ],
          summary: '旁白预算反馈保持脚本可执行。',
          targetPlatform: 'generic',
          theme: 'clean-white',
          title: '旁白预算',
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
      '/tmp/timing.md',
      '旁白预算反馈需要明确。',
      {
        deckFormat: 'landscape_1920x1080',
        durationTargetSeconds: 12,
        language: 'zh-CN',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )
    const scriptRewriteRequests = requests.filter((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics' && (request.messages?.length ?? 0) > 1)
    const timingRewritePayload = JSON.parse(typeof scriptRewriteRequests[0]?.messages?.at(-1)?.content === 'string' ? scriptRewriteRequests[0]?.messages?.at(-1)?.content as string : '{}') as {
      issues: Array<{code?: string; field?: string; path?: string}>
    }

    expect(scriptCalls).to.equal(2)
    expect(coherenceCalls).to.equal(2)
    expect(timingRewritePayload.issues[0]).to.deep.include({
      code: 'SCRIPT_TIMING_TOTAL_BUDGET',
      field: 'speakerNote',
      path: 'scriptSemantics.slides[].speakerNote',
    })
    expect(plan.deck.slides[0]?.speakerNote).to.equal(shortNote)
  })

  it('rewrites script semantic text with layout-whitespace feedback', async () => {
    const requests: Array<GenerateObjectRequest<unknown>> = []
    let coherenceCalls = 0
    let scriptCalls = 0
    const invalidBlockText = 'Provider certification\nneeds clean semantic text.'
    const cleanBlockText = 'Provider certification needs clean semantic text.'
    const llm: LLMClient = {
      async generateObject<T>(request: GenerateObjectRequest<T>) {
        requests.push(request as GenerateObjectRequest<unknown>)

        if (requestStage(request) === 'script-semantics') {
          scriptCalls += 1
        }

        if (requestStage(request) === 'coherence-review') {
          coherenceCalls += 1

          return {
            object: {
              issues: [],
              summary: 'The deck is coherent enough for artifact build.',
            } as T,
          }
        }

        const rawPlan = withDeckTransitions({
          language: 'en-US',
          outline: deckOutline(),
          slides: [
            {
              duration: 18,
              motion: 'spotlight',
              points: ['Stable trace'],
              semantic: deckSemantic(scriptCalls === 1 ? invalidBlockText : cleanBlockText),
              sourceRange: [0, 18],
              speakerNote: 'Explain why provider output must already be clean.',
              title: 'Certification',
              type: 'one-big-idea',
              visual: deckVisual('text'),
            },
          ],
          summary: 'Provider certification stabilizes semantic text.',
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
      '/tmp/script-semantic-text.md',
      'Provider certification needs clean semantic text.',
      {
        deckFormat: 'portrait_1080x1920',
        durationTargetSeconds: 18,
        language: 'en-US',
        maxSlideCharacters: 260,
        sourceType: 'markdown',
      },
    )
    const scriptRewriteRequest = requests.find((request) => requestStage(request as GenerateObjectRequest<unknown>) === 'script-semantics' && (request.messages?.length ?? 0) > 1)
    const rewritePayload = JSON.parse(typeof scriptRewriteRequest?.messages?.at(-1)?.content === 'string' ? scriptRewriteRequest.messages.at(-1)?.content as string : '{}') as {
      issues: Array<{field?: string; path?: string}>
    }

    expect(scriptCalls).to.equal(2)
    expect(coherenceCalls).to.equal(2)
    expect(rewritePayload.issues[0]).to.deep.include({
      field: 'semantic.blockText',
      path: 'scriptSemantics.slides[0].semantic.blockText',
    })
    expect(plan.speakerScript.segments[0]?.text).to.equal('Explain why provider output must already be clean.')
  })

  it('rejects visible point text over template character limits instead of clipping it locally', () => {
    expect(() => createTextDeckProjectPlanFromLLM(
      '/tmp/provider-hardening.md',
      'Provider certification needs stable failures, costs, retries, and traces.',
      {
        language: 'en-US',
        outline: deckOutline(1),
        slides: [
          {
            duration: 18,
            motion: 'spotlight',
            points: ['把失败信息、成本、重试、trace、证据、预算、认证结果和审计路径全部稳定到可审计状态'],
            semantic: deckSemantic('把失败信息、成本、重试、trace、证据、预算、认证结果和审计路径全部稳定到可审计状态'),
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

    expect(requests.length).to.equal(9)
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

    expect(requests.length).to.equal(9)
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

    expect(requests.length).to.equal(10)
    expect(firstRewritePayload.attemptsRemaining).to.equal(4)
    expect(secondRewritePayload.attemptsRemaining).to.equal(3)
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
    )).to.throw('Slide timing end must be greater than start')
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

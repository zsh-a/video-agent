import type {Claim, Claims, ContentBlock, Deck, DeckFormat, DeckQualityIssue, DeckQualityReport, DeckSlideQualityMetrics, DeckSlideType, DeckVisual, Document, LongVideoSelectedMoments, MediaInfo, Narration, Outline, Slide, SlideTiming, SourceQuote, SourceQuotes, SpeakerScript, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {LLMClient} from '@video-agent/llm'
import type {Transcript, TTSSegment} from '@video-agent/providers'
import type {QualityIssue} from '@video-agent/quality'
import type {HyperframesCliResult} from '@video-agent/renderer-hyperframes'

import {JsonJobStore} from '@video-agent/db'
import {ClaimsSchema, ContentBlocksSchema, DeckQualityReportSchema, DeckSchema, DocumentSchema, NarrationSchema, OutlineSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'
import {probeMedia, runFfmpeg} from '@video-agent/media'
import {TranscriptSchema, TtsSegmentsSchema} from '@video-agent/providers'
import {checkExplainerStructure, checkNarrationTiming, checkRenderedMedia, checkStoryboardConsistency, checkTimelineBounds, createRenderedMediaProbeFailure} from '@video-agent/quality'
import {captureDeckHtmlFrames, type DeckHtmlFrame, writeDeckHtmlProject} from '@video-agent/renderer-html'
import {renderHyperframesProject, validateHyperframesProject} from '@video-agent/renderer-hyperframes'
import {mkdir, rm} from 'node:fs/promises'
import {extname, join, resolve} from 'node:path'
import {z} from 'zod'

import {refreshArtifactManifest} from './artifact-store.js'
import {bunFile, bunWrite} from './bun-runtime.js'
import {readConfig} from './config.js'
import {assertFileExists} from './file-io.js'
import {createRuntimeLLMClient, createRuntimeProviders} from './runtime-providers.js'
import {createProjectWorkspace} from './workspace.js'

export interface CreateDeckExplainerProjectOptions {
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  inputPath: string
  language?: string
  llmClient?: LLMClient
  maxSlideCharacters?: number
  mode?: 'script-generated'
  projectId?: string
  slideSeconds?: number
  theme?: string
  title?: string
  workspaceDir?: string
}

export interface CreateDeckExplainerProjectResult {
  artifacts: {
    contentBlocks: string
    claims: string
    deck: string
    document: string
    mediaInfo: string
    narration: string
    outline: string
    qualityReport: string
    selectedMoments: string
    speakerScript: string
    sourceQuotes: string
    storyboard: string
    timedDeck: string
    timeline: string
  }
  projectDir: string
  projectId: string
  slides: number
  status: 'completed'
}

export interface CreateDeckVoiceoverProjectOptions {
  projectId: string
  workspaceDir?: string
}

export interface DeckVoiceoverSegment {
  duration: number
  narrationId: string
  path: string
  slideId: string
  start: number
}

export interface DeckVoiceover {
  duration: number
  generatedAt: string
  outputPath: string
  segments: DeckVoiceoverSegment[]
  version: 1
}

export interface CreateDeckVoiceoverProjectResult {
  artifacts: {
    deckVoiceover: string
    mediaInfo: string
    narration: string
    qualityReport: string
    selectedMoments: string
    storyboard: string
    timedDeck: string
    timeline: string
    ttsSegments: string
  }
  duration: number
  outputPath: string
  projectDir: string
  projectId: string
  slides: number
  status: 'voiced'
}

export interface CreateDeckFinalRenderProjectOptions {
  chromiumCommand?: string[]
  htmlOutput?: string
  htmlRender?: boolean
  htmlRenderCommand?: string[]
  htmlValidate?: boolean
  projectId: string
  workspaceDir?: string
}

export interface CreateDeckFinalRenderProjectResult {
  artifactPath: string
  audioPath: string
  deckQualityReportPath: string
  frameRenderer: 'chromium'
  frameCount: number
  htmlEntryPath: string
  htmlOutputDir: string
  outputPath: string
  projectDir: string
  projectId: string
  rendered?: HyperframesCliResult
  renderer: 'html'
  status: 'rendered'
  validation?: HyperframesCliResult
  videoRenderer: 'chromium+ffmpeg'
}

export interface CreateDeckAudioAnchoredProjectOptions {
  deckFormat?: DeckFormat
  inputPath: string
  language?: string
  maxSlideCharacters?: number
  projectId?: string
  slideSeconds?: number
  theme?: string
  title?: string
  workspaceDir?: string
}

export interface CreateDeckAudioAnchoredProjectResult {
  artifacts: {
    contentBlocks: string
    claims: string
    deck: string
    deckVoiceover: string
    document: string
    mediaInfo: string
    narration: string
    outline: string
    qualityReport: string
    selectedMoments: string
    speakerScript: string
    sourceQuotes: string
    storyboard: string
    timedDeck: string
    timeline: string
    transcript: string
  }
  duration: number
  outputPath: string
  projectDir: string
  projectId: string
  slides: number
  status: 'completed'
}

export interface CreateDeckAudioSummaryProjectResult extends CreateDeckExplainerProjectResult {
  artifacts: CreateDeckExplainerProjectResult['artifacts'] & {
    transcript: string
  }
  sourceMode: 'audio-summary'
}

export type CreateDeckSummarizeProjectOptions = Omit<CreateDeckExplainerProjectOptions, 'mode'>
export type CreateDeckSummarizeProjectResult = CreateDeckExplainerProjectResult | CreateDeckAudioSummaryProjectResult

const DEFAULT_MAX_SLIDE_CHARACTERS = 260
const DEFAULT_SLIDE_SECONDS = 18
const DEFAULT_DECK_THEME: Deck['theme'] = 'elegant-dark'
const DECK_THEMES = ['auto', 'elegant-dark', 'clean-white', 'finance-terminal', 'tech-gradient', 'minimal-editorial', 'warm-paper'] as const
const DECK_THEME_DESCRIPTIONS: Record<string, string> = {
  'elegant-dark': '深色科技风，适合技术、AI、数据、编程主题',
  'clean-white': '简洁白净，适合商业汇报、教育、通用主题',
  'finance-terminal': '终端绿色风，适合金融、加密货币、数据终端主题',
  'tech-gradient': '蓝紫渐变，适合前沿科技、创新、未来感主题',
  'minimal-editorial': '暖色纸张风，适合人文、编辑、出版、学术主题',
  'warm-paper': '暖橙纸张风，适合生活、文化、温暖、故事性主题',
}
const DECK_AUDIO_ANCHORED_STAGES = ['ingest', 'transcribe', 'plan', 'align', 'quality'] as const
const DECK_SUMMARIZE_STAGES = ['ingest', 'transcribe', 'understand', 'plan', 'script', 'quality'] as const
const DECK_STAGES = ['ingest', 'understand', 'plan', 'script', 'synthesize-voice', 'update-timing', 'render-final', 'quality'] as const

interface TextDeckProjectPlan {
  claims: Claims
  contentBlocks: {blocks: ContentBlock[]; version: 1}
  deck: Deck
  document: Document
  mediaInfo: MediaInfo
  narration: Narration
  outline: Outline
  qualityReport: {
    checkedAt: string
    issues: QualityIssue[]
    narrationSegments: number
    summary: {errors: number; warnings: number}
    ttsSegments: number
    version: 1
  }
  selectedMoments: LongVideoSelectedMoments
  sourceQuotes: SourceQuotes
  speakerScript: SpeakerScript
  storyboard: Storyboard
  timedDeck: TimedDeck
  timeline: Timeline
}

export async function createDeckExplainerProject(options: CreateDeckExplainerProjectOptions): Promise<CreateDeckExplainerProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const text = normalizeText(await bunFile(inputPath).text())

  if (text === '') {
    throw new Error('Text explainer input must not be empty.')
  }

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const language = options.language ?? 'zh-CN'
  const config = await readConfig(workspace.workspaceDir)
  const llmClient = await createRuntimeLLMClient(config, workspace.workspaceDir, {
    llmClient: options.llmClient,
  })
  const plan = llmClient === undefined
    ? createFallbackTextDeckProjectPlan(inputPath, text, {
        deckFormat: options.deckFormat,
        durationTargetSeconds: options.durationTargetSeconds,
        language,
        maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
        slideSeconds: options.slideSeconds ?? DEFAULT_SLIDE_SECONDS,
        theme: options.theme,
        title: options.title,
      })
    : await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
        deckFormat: options.deckFormat,
        durationTargetSeconds: options.durationTargetSeconds,
        language,
        maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
        slideSeconds: options.slideSeconds ?? DEFAULT_SLIDE_SECONDS,
        sourceType: inferDocumentSourceType(inputPath),
        theme: options.theme,
        title: options.title,
      })
  const artifacts = {
    document: await workspace.store.writeJson('document.json', plan.document),
    contentBlocks: await workspace.store.writeJson('content-blocks.json', plan.contentBlocks),
    claims: await workspace.store.writeJson('claims.json', plan.claims),
    sourceQuotes: await workspace.store.writeJson('source-quotes.json', plan.sourceQuotes),
    outline: await workspace.store.writeJson('outline.json', plan.outline),
    deck: await workspace.store.writeJson('deck.json', plan.deck),
    speakerScript: await workspace.store.writeJson('speaker-script.json', plan.speakerScript),
    timedDeck: await workspace.store.writeJson('timed-deck.json', plan.timedDeck),
    mediaInfo: await workspace.store.writeJson('media-info.json', plan.mediaInfo),
    selectedMoments: await workspace.store.writeJson('selected-moments.json', plan.selectedMoments),
    storyboard: await workspace.store.writeJson('storyboard.json', plan.storyboard),
    timeline: await workspace.store.writeJson('timeline.json', plan.timeline),
    narration: await workspace.store.writeJson('narration.json', plan.narration),
    qualityReport: await workspace.store.writeJson('quality-report.json', plan.qualityReport),
  }
  const jobStore = new JsonJobStore(resolve(workspace.projectDir, 'job-state.json'))

  await jobStore.initialize({
    inputPath,
    projectId: workspace.projectId,
    stages: DECK_STAGES,
  })

  await ['ingest', 'understand', 'plan', 'script', 'quality'].reduce(
    async (previous, stage) => {
      await previous
      await jobStore.updateStage(stage, 'completed', undefined, 1)
    },
    Promise.resolve(),
  )

  await jobStore.complete('completed')
  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifacts,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    slides: plan.deck.slides.length,
    status: 'completed',
  }
}

export async function createDeckSummarizeProject(options: CreateDeckSummarizeProjectOptions): Promise<CreateDeckSummarizeProjectResult> {
  const inputPath = resolve(options.inputPath)

  if (!isAudioInputPath(inputPath)) {
    return createDeckExplainerProject({
      ...options,
      mode: 'script-generated',
    })
  }

  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const workspaceDir = workspace.workspaceDir
  const jobStore = new JsonJobStore(resolve(workspace.projectDir, 'job-state.json'))

  await jobStore.initialize({
    inputPath,
    projectId: workspace.projectId,
    stages: DECK_SUMMARIZE_STAGES,
  })
  await jobStore.updateStage('ingest', 'running', undefined, 1)

  try {
    const sourceMediaInfo = await probeMedia(inputPath)
    const sourceDuration = sourceMediaInfo.duration ?? DEFAULT_SLIDE_SECONDS
    const config = await readConfig(workspaceDir)
    const providers = await createRuntimeProviders(config, workspaceDir)

    await jobStore.updateStage('ingest', 'completed', undefined, 1)
    await jobStore.updateStage('transcribe', 'running', undefined, 1)

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration: sourceDuration,
      path: inputPath,
    }))
    const text = normalizeText(transcript.text || transcript.segments.map((segment) => segment.text).join('\n\n'))

    if (text === '') {
      throw new Error('Deck summarize audio transcript must not be empty.')
    }

    await jobStore.updateStage('transcribe', 'completed', undefined, 1)
    await jobStore.updateStage('understand', 'running', undefined, 1)

    const language = options.language ?? transcript.language ?? 'zh-CN'
    const slideSeconds = options.slideSeconds ?? DEFAULT_SLIDE_SECONDS
    const slides = createTextSlides(text, {
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      title: options.title,
    })
    const title = options.title ?? slides[0]?.title ?? 'Audio Summary Deck'
    const deckSlideSeconds = options.durationTargetSeconds === undefined ? slideSeconds : Math.max(1, options.durationTargetSeconds / Math.max(1, slides.length))
    const mediaInfo = createTextMediaInfo(inputPath, slides.length * deckSlideSeconds)
    const selectedMoments = createTextSelectedMoments(inputPath, slides, deckSlideSeconds)
    const document = DocumentSchema.parse(createSummarizedAudioDocument(inputPath, transcript, text, slides, language, title))
    const contentBlocks = ContentBlocksSchema.parse({
      blocks: document.blocks,
      version: 1,
    })
    const claims = ClaimsSchema.parse(createClaimsFromDocument(document))
    const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromDocument(document))

    await jobStore.updateStage('understand', 'completed', undefined, 1)
    await jobStore.updateStage('plan', 'running', undefined, 1)

    const outline = OutlineSchema.parse(createTextOutline(slides, language, title, options.durationTargetSeconds))
    const deck = DeckSchema.parse(createTextDeck(slides, language, title, {
      format: options.deckFormat,
      theme: options.theme,
    }))
    const speakerScript = SpeakerScriptSchema.parse(createTextSpeakerScript(slides, language))
    const timings = createSlideTimings(slides, deckSlideSeconds)
    const timedDeck = TimedDeckSchema.parse(createTimedDeck(deck, timings))
    const storyboard = StoryboardSchema.parse(createTextStoryboard(slides, deckSlideSeconds, language))
    const timeline = TimelineSchema.parse(createTextTimeline(slides.length * deckSlideSeconds))
    const narration = NarrationSchema.parse(createTextNarration(storyboard, slides, language))
    const issues = createTextQualityIssues({
      mediaInfo,
      narration,
      selectedMoments,
      storyboard,
      timeline,
    })
    const qualityReport = {
      checkedAt: new Date().toISOString(),
      issues,
      narrationSegments: narration.segments.length,
      summary: summarizeQualityIssues(issues),
      ttsSegments: 0,
      version: 1 as const,
    }
    const artifacts = {
      transcript: await workspace.store.writeJson('transcript.json', transcript),
      document: await workspace.store.writeJson('document.json', document),
      contentBlocks: await workspace.store.writeJson('content-blocks.json', contentBlocks),
      claims: await workspace.store.writeJson('claims.json', claims),
      sourceQuotes: await workspace.store.writeJson('source-quotes.json', sourceQuotes),
      outline: await workspace.store.writeJson('outline.json', outline),
      deck: await workspace.store.writeJson('deck.json', deck),
      speakerScript: await workspace.store.writeJson('speaker-script.json', speakerScript),
      timedDeck: await workspace.store.writeJson('timed-deck.json', timedDeck),
      mediaInfo: await workspace.store.writeJson('media-info.json', mediaInfo),
      selectedMoments: await workspace.store.writeJson('selected-moments.json', selectedMoments),
      storyboard: await workspace.store.writeJson('storyboard.json', storyboard),
      timeline: await workspace.store.writeJson('timeline.json', timeline),
      narration: await workspace.store.writeJson('narration.json', narration),
      qualityReport: await workspace.store.writeJson('quality-report.json', qualityReport),
    }

    await jobStore.updateStage('plan', 'completed', undefined, 1)
    await jobStore.updateStage('script', 'completed', undefined, 1)
    await jobStore.updateStage('quality', 'completed', undefined, 1)
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      slides: slides.length,
      sourceMode: 'audio-summary',
      status: 'completed',
    }
  } catch (error) {
    await jobStore.updateStage('transcribe', 'failed', error instanceof Error ? error.message : String(error), 1)
    throw error
  }
}

export async function createDeckAudioAnchoredProject(options: CreateDeckAudioAnchoredProjectOptions): Promise<CreateDeckAudioAnchoredProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const workspaceDir = workspace.workspaceDir
  const jobStore = new JsonJobStore(resolve(workspace.projectDir, 'job-state.json'))

  await jobStore.initialize({
    inputPath,
    projectId: workspace.projectId,
    stages: DECK_AUDIO_ANCHORED_STAGES,
  })
  await jobStore.updateStage('ingest', 'running', undefined, 1)

  try {
    const outputPath = resolve(workspace.audioDir, 'deck_voiceover.wav')

    await convertDeckSourceAudio(inputPath, outputPath)

    const mediaInfo = await probeMedia(outputPath)
    const duration = mediaInfo.duration ?? DEFAULT_SLIDE_SECONDS
    const config = await readConfig(workspaceDir)
    const providers = await createRuntimeProviders(config, workspaceDir)

    await jobStore.updateStage('ingest', 'completed', undefined, 1)
    await jobStore.updateStage('transcribe', 'running', undefined, 1)

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration,
      path: inputPath,
    }))
    const language = options.language ?? transcript.language ?? 'zh-CN'
    const slides = createAudioAnchoredSlides(transcript, duration, {
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      slideSeconds: options.slideSeconds ?? DEFAULT_SLIDE_SECONDS,
      title: options.title,
    })
    const title = options.title ?? slides[0]?.title ?? 'Audio Deck Explainer'

    await jobStore.updateStage('transcribe', 'completed', undefined, 1)
    await jobStore.updateStage('plan', 'running', undefined, 1)

    const document = DocumentSchema.parse(createAudioDocument(inputPath, transcript, slides, language, title))
    const contentBlocks = ContentBlocksSchema.parse({
      blocks: document.blocks,
      version: 1,
    })
    const claims = ClaimsSchema.parse(createClaimsFromDocument(document))
    const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromDocument(document))
    const outline = OutlineSchema.parse(createAudioOutline(slides, language, title, duration))
    const deck = DeckSchema.parse(createAudioDeck(slides, language, title, {
      format: options.deckFormat,
      theme: options.theme,
    }))
    const speakerScript = SpeakerScriptSchema.parse(createAudioSpeakerScript(slides, language))
    const timings = createAudioSlideTimings(slides, duration)
    const timedDeck = TimedDeckSchema.parse({
      audioRef: 'audio/deck_voiceover.wav',
      deck,
      timings,
      version: 1,
    })
    const storyboard = StoryboardSchema.parse(createAudioStoryboard(slides, language))
    const timeline = TimelineSchema.parse(createTextTimeline(duration))
    const narration = NarrationSchema.parse(createAudioNarration(slides, language))
    const selectedMoments = createAudioSelectedMoments(inputPath, slides)
    const deckVoiceover = {
      duration,
      generatedAt: new Date().toISOString(),
      outputPath: 'audio/deck_voiceover.wav',
      segments: slides.map((slide, index) => ({
        duration: roundSeconds(slide.end - slide.start),
        narrationId: `narration-${index + 1}`,
        path: 'audio/deck_voiceover.wav',
        slideId: `slide-${String(index + 1).padStart(3, '0')}`,
        start: slide.start,
      })),
      version: 1 as const,
    }
    const issues = createTextQualityIssues({
      mediaInfo,
      narration,
      selectedMoments,
      storyboard,
      timeline,
    })
    const qualityReport = {
      checkedAt: new Date().toISOString(),
      issues,
      narrationSegments: narration.segments.length,
      summary: summarizeQualityIssues(issues),
      ttsSegments: 0,
      version: 1 as const,
    }
    const artifacts = {
      transcript: await workspace.store.writeJson('transcript.json', transcript),
      document: await workspace.store.writeJson('document.json', document),
      contentBlocks: await workspace.store.writeJson('content-blocks.json', contentBlocks),
      claims: await workspace.store.writeJson('claims.json', claims),
      sourceQuotes: await workspace.store.writeJson('source-quotes.json', sourceQuotes),
      outline: await workspace.store.writeJson('outline.json', outline),
      deck: await workspace.store.writeJson('deck.json', deck),
      speakerScript: await workspace.store.writeJson('speaker-script.json', speakerScript),
      timedDeck: await workspace.store.writeJson('timed-deck.json', timedDeck),
      deckVoiceover: await workspace.store.writeJson('deck-voiceover.json', deckVoiceover),
      mediaInfo: await workspace.store.writeJson('media-info.json', mediaInfo),
      selectedMoments: await workspace.store.writeJson('selected-moments.json', selectedMoments),
      storyboard: await workspace.store.writeJson('storyboard.json', storyboard),
      timeline: await workspace.store.writeJson('timeline.json', timeline),
      narration: await workspace.store.writeJson('narration.json', narration),
      qualityReport: await workspace.store.writeJson('quality-report.json', qualityReport),
    }

    await jobStore.updateStage('plan', 'completed', undefined, 1)
    await jobStore.updateStage('align', 'completed', undefined, 1)
    await jobStore.updateStage('quality', 'completed', undefined, 1)
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      duration,
      outputPath,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      slides: slides.length,
      status: 'completed',
    }
  } catch (error) {
    await jobStore.updateStage('transcribe', 'failed', error instanceof Error ? error.message : String(error), 1)
    throw error
  }
}

export async function createDeckVoiceoverProject(options: CreateDeckVoiceoverProjectOptions): Promise<CreateDeckVoiceoverProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await jobStore.initialize({
    inputPath: state.inputPath,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('synthesize-voice', 'running', undefined, 1)

  try {
    const config = await readConfig(workspaceDir)
    const providers = await createRuntimeProviders(config, workspaceDir)
    const [deck, speakerScript, currentTimedDeck, currentStoryboard, currentSelectedMoments, currentMediaInfo] = await Promise.all([
      DeckSchema.parseAsync(await workspace.store.readJson('deck.json')),
      SpeakerScriptSchema.parseAsync(await workspace.store.readJson('speaker-script.json')),
      TimedDeckSchema.parseAsync(await workspace.store.readJson('timed-deck.json')),
      StoryboardSchema.parseAsync(await workspace.store.readJson('storyboard.json')),
      workspace.store.readJson('selected-moments.json') as Promise<LongVideoSelectedMoments>,
      workspace.store.readJson('media-info.json') as Promise<MediaInfo>,
    ])
    const initialNarration = createDeckNarrationFromSpeakerScript(speakerScript, currentTimedDeck)
    const ttsSegments = TtsSegmentsSchema.parse(await providers.tts.synthesize(initialNarration.segments, {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    }))
    const timings = createSlideTimingsFromTts(speakerScript, currentTimedDeck, ttsSegments)
    const totalDuration = timings.at(-1)?.end ?? 0
    const voiceoverPath = resolve(workspace.audioDir, 'deck_voiceover.wav')

    await renderDeckVoiceover(workspace.projectDir, ttsSegments, voiceoverPath)

    const timedDeck = TimedDeckSchema.parse({
      audioRef: 'audio/deck_voiceover.wav',
      deck,
      timings,
      version: 1,
    })
    const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
    const storyboard = StoryboardSchema.parse(updateStoryboardTiming(currentStoryboard, narration, timings))
    const timeline = TimelineSchema.parse(createTextTimeline(totalDuration))
    const selectedMoments = updateSelectedMomentsTiming(currentSelectedMoments, timings)
    const mediaInfo = {
      ...currentMediaInfo,
      duration: totalDuration,
      probedAt: new Date().toISOString(),
    }
    const issues = createTextQualityIssues({
      mediaInfo,
      narration,
      selectedMoments,
      storyboard,
      timeline,
    })
    const qualityReport = {
      checkedAt: new Date().toISOString(),
      issues,
      narrationSegments: narration.segments.length,
      summary: summarizeQualityIssues(issues),
      ttsSegments: ttsSegments.length,
      version: 1 as const,
    }
    const deckVoiceover = {
      duration: totalDuration,
      generatedAt: new Date().toISOString(),
      outputPath: 'audio/deck_voiceover.wav',
      segments: ttsSegments.map((segment, index) => {
        const timing = timings[index]

        return {
          duration: timing === undefined ? segment.duration : timing.end - timing.start,
          narrationId: segment.narrationId,
          path: segment.path,
          slideId: speakerScript.segments[index]?.slideId ?? `slide-${String(index + 1).padStart(3, '0')}`,
          start: timing?.start ?? 0,
        }
      }),
      version: 1 as const,
    }
    const artifacts = {
      ttsSegments: await workspace.store.writeJson('tts-segments.json', ttsSegments),
      deckVoiceover: await workspace.store.writeJson('deck-voiceover.json', deckVoiceover),
      timedDeck: await workspace.store.writeJson('timed-deck.json', timedDeck),
      mediaInfo: await workspace.store.writeJson('media-info.json', mediaInfo),
      selectedMoments: await workspace.store.writeJson('selected-moments.json', selectedMoments),
      storyboard: await workspace.store.writeJson('storyboard.json', storyboard),
      timeline: await workspace.store.writeJson('timeline.json', timeline),
      narration: await workspace.store.writeJson('narration.json', narration),
      qualityReport: await workspace.store.writeJson('quality-report.json', qualityReport),
    }

    await jobStore.updateStage('synthesize-voice', 'completed', undefined, 1)
    await jobStore.updateStage('update-timing', 'completed', undefined, 1)
    await jobStore.updateStage('quality', 'completed', undefined, 1)
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      duration: totalDuration,
      outputPath: voiceoverPath,
      projectDir: workspace.projectDir,
      projectId,
      slides: deck.slides.length,
      status: 'voiced',
    }
  } catch (error) {
    await jobStore.updateStage('synthesize-voice', 'failed', error instanceof Error ? error.message : String(error), 1)
    throw error
  }
}

export async function createDeckFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })

  await jobStore.initialize({
    inputPath: state.inputPath,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('render-final', 'running', undefined, 1)

  try {
    const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
    const audioRef = timedDeck.audioRef ?? 'audio/deck_voiceover.wav'
    const audioPath = resolve(workspace.projectDir, audioRef)
    const framesDir = resolve(workspace.rendersDir, 'deck-frames')
    const clipsDir = resolve(workspace.rendersDir, 'deck-clips')
    const htmlOutputDir = resolve(workspace.rendersDir, 'html')
    const htmlRenderedOutputPath = resolve(options.htmlOutput ?? resolve(workspace.rendersDir, 'deck_html_capture.mp4'))
    const concatPath = resolve(clipsDir, 'clips.txt')
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')

    await assertFileExists(audioPath)
    await Promise.all([
      rm(framesDir, {force: true, recursive: true}),
      rm(clipsDir, {force: true, recursive: true}),
      rm(htmlOutputDir, {force: true, recursive: true}),
    ])
    await mkdir(framesDir, {recursive: true})

    const htmlProject = await writeDeckHtmlProject({
      outputDir: htmlOutputDir,
      timedDeck,
    })
    const validation = options.htmlValidate === true
      ? await validateHyperframesProject({
          command: options.htmlRenderCommand,
          projectDir: htmlProject.outputDir,
        })
      : undefined
    const rendered = options.htmlRender === true
      ? await renderHyperframesProject({
          command: options.htmlRenderCommand,
          outputPath: htmlRenderedOutputPath,
          projectDir: htmlProject.outputDir,
        })
      : undefined
    const frameCapture = await captureDeckHtmlFrames({
      chromiumCommand: options.chromiumCommand,
      outputDir: framesDir,
      projectDir: htmlProject.outputDir,
      timedDeck,
    })
    const clips = await renderDeckFrameClips(frameCapture.frames, clipsDir)

    await writeDeckClipConcatList(clips, concatPath)
    await concatDeckFrameClips(concatPath, silentVideoPath)
    await muxDeckFinalVideo(silentVideoPath, audioPath, outputPath)

    const outputQuality = await inspectDeckRenderedOutput(outputPath, {
      expectedDuration: timedDeck.timings.at(-1)?.end ?? 0,
    })
    const deckQualityReport = DeckQualityReportSchema.parse(createDeckQualityReport(timedDeck))
    const deckQualityReportPath = await workspace.store.writeJson('deck-quality-report.json', deckQualityReport)
    const artifactPath = await workspace.store.writeJson('render-output.json', {
      audioInputs: 1,
      audioPath: toProjectPath(workspace.projectDir, audioPath),
      completedAt: new Date().toISOString(),
      entryHtml: toProjectPath(workspace.projectDir, htmlProject.entryHtml),
      clipCount: clips.length,
      clipsDir: toProjectPath(workspace.projectDir, clipsDir),
      frameCount: frameCapture.frames.length,
      frameRenderer: 'chromium' as const,
      framesDir: toProjectPath(workspace.projectDir, frameCapture.outputDir),
      outputDir: toProjectPath(workspace.projectDir, htmlProject.outputDir),
      outputPath: toProjectPath(workspace.projectDir, outputPath),
      outputQuality,
      planPath: toProjectPath(workspace.projectDir, htmlProject.planPath),
      renderer: 'html' as const,
      rendered,
      runtimePath: toProjectPath(workspace.projectDir, htmlProject.runtimePath),
      silentVideoPath: toProjectPath(workspace.projectDir, silentVideoPath),
      source: 'timed-deck.json',
      stylesPath: toProjectPath(workspace.projectDir, htmlProject.stylesPath),
      validation,
      version: 1 as const,
      videoRenderer: 'chromium+ffmpeg' as const,
    })

    await jobStore.updateStage('render-final', 'completed', undefined, 1)
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      audioPath,
      deckQualityReportPath,
      frameCount: frameCapture.frames.length,
      frameRenderer: 'chromium',
      htmlEntryPath: htmlProject.entryHtml,
      htmlOutputDir: htmlProject.outputDir,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      ...(rendered === undefined ? {} : {rendered}),
      renderer: 'html',
      status: 'rendered',
      ...(validation === undefined ? {} : {validation}),
      videoRenderer: 'chromium+ffmpeg',
    }
  } catch (error) {
    await jobStore.updateStage('render-final', 'failed', error instanceof Error ? error.message : String(error), 1)
    throw error
  }
}

interface TextSlide {
  body: string
  index: number
  title: string
}

interface AudioSlide extends TextSlide {
  end: number
  start: number
}

function createAudioAnchoredSlides(transcript: Transcript, duration: number, options: {maxSlideCharacters: number; slideSeconds: number; title?: string}): AudioSlide[] {
  const timedSegments = transcript.segments.filter((segment) => segment.end > segment.start && segment.text.trim() !== '')

  if (timedSegments.length > 0 && transcript.timestampConfidence !== 'untimed') {
    return timedSegments.map((segment, index) => ({
      body: normalizeText(segment.text),
      end: roundSeconds(Math.min(duration, segment.end)),
      index,
      start: roundSeconds(Math.min(duration, segment.start)),
      title: index === 0 && options.title !== undefined ? options.title : createSlideTitle(segment.text, index),
    })).filter((slide) => slide.end > slide.start)
  }

  const text = normalizeText(transcript.text || transcript.segments.map((segment) => segment.text).join(' '))
  const bodies = splitTextSections(text === '' ? 'Audio transcript unavailable.' : text, options.maxSlideCharacters)
  const slideCount = Math.max(1, Math.ceil(duration / options.slideSeconds), bodies.length)
  const slideDuration = duration / slideCount

  return Array.from({length: slideCount}, (_, index) => {
    const body = bodies[index % bodies.length] ?? 'Audio transcript unavailable.'
    const start = roundSeconds(index * slideDuration)
    const end = roundSeconds(index === slideCount - 1 ? duration : (index + 1) * slideDuration)

    return {
      body,
      end,
      index,
      start,
      title: index === 0 && options.title !== undefined ? options.title : createSlideTitle(body, index),
    }
  })
}

function createAudioDocument(inputPath: string, transcript: Transcript, slides: AudioSlide[], language: string, title: string): Document {
  return {
    blocks: slides.map((slide) => createAudioContentBlock(slide)),
    source: {
      language,
      path: inputPath,
      sourceType: 'audio',
      title,
    },
    text: transcript.text || slides.map((slide) => slide.body).join('\n\n'),
    version: 1,
  }
}

function createAudioContentBlock(slide: AudioSlide): ContentBlock {
  return {
    evidence: [{ref: 'transcript.json', text: slide.body, type: 'asr'}],
    id: `block-${String(slide.index + 1).padStart(3, '0')}`,
    sourceRange: [Math.round(slide.start * 1000), Math.round(slide.end * 1000)],
    text: slide.body,
    type: slide.index === 0 ? 'context' : 'claim',
  }
}

function createAudioOutline(slides: AudioSlide[], language: string, title: string, durationTarget: number): Outline {
  return {
    durationTarget,
    language,
    sections: slides.map((slide) => ({
      blockIds: [`block-${String(slide.index + 1).padStart(3, '0')}`],
      duration: roundSeconds(slide.end - slide.start),
      goal: 'Visualize one audio segment as a slide.',
      id: `section-${String(slide.index + 1).padStart(3, '0')}`,
      title: slide.title,
    })),
    title,
    version: 1,
  }
}

function createAudioDeck(slides: AudioSlide[], language: string, title: string, options: {format?: DeckFormat; theme?: string}): Deck {
  return {
    format: options.format ?? 'portrait_1080x1920',
    inputMode: 'audio-anchored',
    language,
    slides: slides.map((slide) => ({
      blockIds: [`block-${String(slide.index + 1).padStart(3, '0')}`],
      duration: roundSeconds(slide.end - slide.start),
      evidence: [{ref: `transcript.json#${slide.index}`, text: slide.body, type: 'asr'}],
      motion: slide.index === 0 ? 'cinematic-rise' : 'progressive-reveal',
      points: splitSlidePoints(slide.body),
      slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
      speakerNote: slide.body,
      title: slide.index === 0 ? title : slide.title,
      type: slide.index === 0 ? 'hero' : 'three-points',
      visual: {
        assetRefs: [],
        kind: slide.index === 0 ? 'title-card' : 'text',
      },
    })),
    theme: normalizeDeckTheme(options.theme),
    title,
    version: 1,
  }
}

function createAudioSpeakerScript(slides: AudioSlide[], language: string): SpeakerScript {
  return {
    language,
    mode: 'audio-anchored',
    segments: slides.map((slide) => ({
      estimatedDuration: roundSeconds(slide.end - slide.start),
      slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
      text: slide.body,
    })),
    version: 1,
  }
}

function createAudioSlideTimings(slides: AudioSlide[], duration: number): SlideTiming[] {
  return slides.map((slide, index) => ({
    end: index === slides.length - 1 ? roundSeconds(duration) : slide.end,
    slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
    start: slide.start,
  }))
}

function createAudioStoryboard(slides: AudioSlide[], language: string): Storyboard {
  return {
    language,
    scenes: slides.map((slide) => ({
      duration: roundSeconds(slide.end - slide.start),
      evidence: [{ref: 'transcript.json', text: slide.body, type: 'asr'}],
      id: `scene-${slide.index + 1}`,
      narration: slide.body,
      sourceRange: [slide.start, slide.end],
      start: slide.start,
      visualStyle: 'slide_explainer',
    })),
    targetPlatform: 'generic',
    version: 1,
  }
}

function createAudioNarration(slides: AudioSlide[], language: string): Narration {
  return {
    language,
    segments: slides.map((slide, index) => ({
      duration: roundSeconds(slide.end - slide.start),
      id: `narration-${index + 1}`,
      sceneId: `scene-${index + 1}`,
      start: slide.start,
      text: slide.body,
    })),
    version: 1,
  }
}

function createAudioSelectedMoments(inputPath: string, slides: AudioSlide[]): LongVideoSelectedMoments {
  return {
    moments: slides.map((slide) => ({
      chunkId: 'audio-000',
      evidence: [{ref: 'transcript.json', text: slide.body, type: 'asr' as const}],
      id: `audio-slide-${String(slide.index + 1).padStart(3, '0')}`,
      reason: 'Audio transcript segment converted into a synchronized slide.',
      score: 0.8,
      sourceRange: [slide.start, slide.end],
      summary: slide.body,
      title: slide.title,
    })),
    source: inputPath,
    version: 1,
  }
}

async function convertDeckSourceAudio(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    outputPath,
  ])
}

const LLMDeckSlideTypeSchema = z.enum(['hero', 'section', 'one-big-idea', 'three-points', 'comparison', 'process', 'timeline', 'quote', 'stat', 'chart', 'code', 'summary', 'cta'])
const LLMDeckMotionPresetSchema = z.enum(['fade-in', 'slide-up', 'soft-scale', 'blur-rise', 'stagger-up', 'progressive-reveal', 'card-stack', 'line-draw', 'number-count', 'spotlight', 'wipe', 'zoom-focus', 'cinematic-rise'])

const LLMDeckThemeSchema = z.enum(['elegant-dark', 'clean-white', 'finance-terminal', 'tech-gradient', 'minimal-editorial', 'warm-paper'])

const LLMTextDeckPlanSchema = z.object({
  audience: z.string().optional(),
  slides: z.array(z.object({
    code: z.object({
      language: z.string().min(1).default('text'),
      text: z.string().min(1),
    }).optional(),
    comparison: z.object({
      left: z.object({
        label: z.string().min(1),
        points: z.array(z.string().min(1)).max(3).default([]),
      }),
      right: z.object({
        label: z.string().min(1),
        points: z.array(z.string().min(1)).max(3).default([]),
      }),
    }).optional(),
    duration: z.number().finite().positive().optional(),
    motion: LLMDeckMotionPresetSchema.optional(),
    points: z.array(z.string().min(1)).max(4).default([]),
    quote: z.object({
      attribution: z.string().min(1).optional(),
      text: z.string().min(1),
    }).optional(),
    speakerNote: z.string().min(1),
    stat: z.object({
      caption: z.string().min(1).optional(),
      label: z.string().min(1),
      value: z.string().min(1),
    }).optional(),
    subtitle: z.string().min(1).optional(),
    title: z.string().min(1),
    type: LLMDeckSlideTypeSchema.optional(),
  })).min(1).max(24),
  summary: z.string().min(1),
  theme: LLMDeckThemeSchema.optional(),
  title: z.string().min(1),
})

type LLMTextDeckPlan = z.infer<typeof LLMTextDeckPlanSchema>

interface TextDeckProjectPlanOptions {
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  language: string
  maxSlideCharacters: number
  slideSeconds: number
  sourceType?: Document['source']['sourceType']
  theme?: string
  title?: string
}

async function createLLMTextDeckProjectPlan(
  llm: LLMClient,
  inputPath: string,
  text: string,
  options: TextDeckProjectPlanOptions,
): Promise<TextDeckProjectPlan> {
  const targetSlideCount = estimateTextDeckSlideCount(text, options.durationTargetSeconds)
  const result = await llm.generateObject({
    messages: [
      {
        content: JSON.stringify({
          goal: 'Turn the source Markdown/text into a concise PPT-style explainer deck. Return only clean semantic slide data matching the schema.',
          instructions: [
            'Use the requested output language for all visible text and speaker notes.',
            'Remove YAML frontmatter, Markdown syntax, code fences, table pipes, raw template markers, and implementation-only metadata.',
            'Do not split sentences by character count. Merge related source sections into audience-facing ideas.',
            'If the source is an agent skill or internal instruction document, explain what it does, when to use it, the workflow, output shape, and quality bar.',
            'Do not paste the raw source verbatim. Rewrite it into natural presentation language.',
            'Keep slide titles short and concrete.',
            'Use 1-4 concise points per content slide.',
            'Choose slide type from controlled templates only: hero, section, one-big-idea, three-points, comparison, process, timeline, quote, stat, chart, code, summary, cta.',
            'Choose motion only from controlled presets; do not describe CSS, colors, fonts, or absolute positions.',
            'Write one natural speakerNote per slide for TTS. It should sound like a presenter, not a file reader.',
            'Avoid page-number prefixes such as "第 1 页" in speakerNote.',
            'Keep speakerNote close to the target narration length unless the slide is an intro or summary.',
            'Choose the most appropriate visual theme from the available themes based on the content topic and tone. Return the theme name in the "theme" field.',
          ],
          source: {
            path: inputPath,
            sourceType: options.sourceType ?? inferDocumentSourceType(inputPath),
            text: truncateForLLM(text, 60_000),
          },
          target: {
            availableThemes: Object.entries(DECK_THEME_DESCRIPTIONS).map(([name, description]) => ({description, name})),
            durationSeconds: options.durationTargetSeconds,
            format: options.deckFormat ?? 'portrait_1080x1920',
            language: options.language,
            maxVisibleCharactersPerSlide: options.maxSlideCharacters,
            requestedTheme: options.theme === undefined || options.theme === 'auto' ? undefined : options.theme,
            requestedTitle: options.title,
            slideCount: targetSlideCount,
            speakerNoteCharactersPerSlide: estimateNarrationCharactersPerSlide(options.durationTargetSeconds, targetSlideCount),
          },
        }),
        role: 'user',
      },
    ],
    schema: LLMTextDeckPlanSchema,
    temperature: 0.2,
  })

  return createTextDeckProjectPlanFromLLM(inputPath, text, result.object, options)
}

function createTextDeckProjectPlanFromLLM(inputPath: string, sourceText: string, rawPlan: LLMTextDeckPlan, options: TextDeckProjectPlanOptions): TextDeckProjectPlan {
  const planTitle = options.title ?? cleanGeneratedText(rawPlan.title, 'Deck Explainer')
  const slides = normalizeLLMTextDeckSlides(rawPlan)
  const sourceEvidence = truncateForLLM(stripMarkdownControlText(sourceText), 4000)
  const deckSlides = slides.map((slide, index): Slide => {
    const slideId = `slide-${String(index + 1).padStart(3, '0')}`
    const blockId = `block-${String(index + 1).padStart(3, '0')}`

    return {
      blockIds: [blockId],
      ...(slide.code === undefined ? {} : {code: slide.code}),
      ...(slide.comparison === undefined ? {} : {comparison: slide.comparison}),
      duration: slide.duration,
      evidence: sourceEvidence === '' ? [] : [{ref: 'text-input', text: sourceEvidence, type: 'research'}],
      motion: slide.motion ?? defaultSlideMotion(index, slide.type),
      points: slide.points,
      ...(slide.quote === undefined ? {} : {quote: slide.quote}),
      slideId,
      speakerNote: slide.speakerNote,
      ...(slide.stat === undefined ? {} : {stat: slide.stat}),
      ...(slide.subtitle === undefined ? {} : {subtitle: slide.subtitle}),
      title: slide.title,
      type: slide.type ?? (index === 0 ? 'hero' : 'three-points'),
      visual: {
        assetRefs: [],
        kind: visualKindForSlideType(slide.type ?? (index === 0 ? 'hero' : 'three-points')),
      },
    }
  })
  const resolvedTheme = resolveTheme(rawPlan.theme, options.theme)
  const deck = DeckSchema.parse({
    format: options.deckFormat ?? 'portrait_1080x1920',
    inputMode: 'script-generated',
    language: options.language,
    slides: deckSlides,
    theme: resolvedTheme,
    title: planTitle,
    version: 1,
  })
  const speakerScript = SpeakerScriptSchema.parse({
    language: options.language,
    mode: 'script-generated',
    segments: slides.map((slide, index) => ({
      estimatedDuration: slide.duration ?? estimateNarrationDuration(slide.speakerNote),
      slideId: deck.slides[index]?.slideId ?? `slide-${String(index + 1).padStart(3, '0')}`,
      text: slide.speakerNote,
    })),
    version: 1,
  })
  const timings = createSlideTimingsFromSpeakerScript(speakerScript, options.durationTargetSeconds, options.slideSeconds)
  const timedDeck = TimedDeckSchema.parse(createTimedDeck(deck, timings))
  const duration = timings.at(-1)?.end ?? deck.slides.length * options.slideSeconds
  const mediaInfo = createTextMediaInfo(inputPath, duration)
  const document = DocumentSchema.parse(createLLMTextDocument(inputPath, sourceText, deck, speakerScript, options.language, planTitle, rawPlan.summary, options.sourceType))
  const contentBlocks = ContentBlocksSchema.parse({
    blocks: document.blocks,
    version: 1,
  })
  const claims = ClaimsSchema.parse(createClaimsFromDocument(document))
  const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromDocument(document))
  const outline = OutlineSchema.parse(createDeckOutlineFromSlides(deck, options.language, planTitle, options.durationTargetSeconds, rawPlan.audience))
  const selectedMoments = createDeckSelectedMoments(inputPath, deck, speakerScript, timings)
  const storyboard = StoryboardSchema.parse(createDeckStoryboard(deck, speakerScript, timings, options.language))
  const timeline = TimelineSchema.parse(createTextTimeline(duration))
  const narration = NarrationSchema.parse(createDeckNarrationFromTimings(speakerScript, timings))
  const qualityReport = createTextPlanQualityReport({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })

  return {
    claims,
    contentBlocks,
    deck,
    document,
    mediaInfo,
    narration,
    outline,
    qualityReport,
    selectedMoments,
    sourceQuotes,
    speakerScript,
    storyboard,
    timedDeck,
    timeline,
  }
}

function createFallbackTextDeckProjectPlan(inputPath: string, text: string, options: TextDeckProjectPlanOptions): TextDeckProjectPlan {
  const slides = createTextSlides(text, {
    maxSlideCharacters: options.maxSlideCharacters,
    title: options.title,
  })
  const title = options.title ?? slides[0]?.title ?? 'Deck Explainer'
  const deckSlideSeconds = options.durationTargetSeconds === undefined ? options.slideSeconds : Math.max(1, options.durationTargetSeconds / Math.max(1, slides.length))
  const mediaInfo = createTextMediaInfo(inputPath, slides.length * deckSlideSeconds)
  const selectedMoments = createTextSelectedMoments(inputPath, slides, deckSlideSeconds)
  const document = DocumentSchema.parse(createTextDocument(inputPath, text, slides, options.language, title))
  const contentBlocks = ContentBlocksSchema.parse({
    blocks: document.blocks,
    version: 1,
  })
  const claims = ClaimsSchema.parse(createClaimsFromDocument(document))
  const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromDocument(document))
  const outline = OutlineSchema.parse(createTextOutline(slides, options.language, title, options.durationTargetSeconds))
  const deck = DeckSchema.parse(createTextDeck(slides, options.language, title, {
    format: options.deckFormat,
    theme: options.theme,
  }))
  const speakerScript = SpeakerScriptSchema.parse(createTextSpeakerScript(slides, options.language))
  const timings = createSlideTimings(slides, deckSlideSeconds)
  const timedDeck = TimedDeckSchema.parse(createTimedDeck(deck, timings))
  const storyboard = StoryboardSchema.parse(createTextStoryboard(slides, deckSlideSeconds, options.language))
  const timeline = TimelineSchema.parse(createTextTimeline(slides.length * deckSlideSeconds))
  const narration = NarrationSchema.parse(createTextNarration(storyboard, slides, options.language))
  const qualityReport = createTextPlanQualityReport({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
    timeline,
  })

  return {
    claims,
    contentBlocks,
    deck,
    document,
    mediaInfo,
    narration,
    outline,
    qualityReport,
    selectedMoments,
    sourceQuotes,
    speakerScript,
    storyboard,
    timedDeck,
    timeline,
  }
}

function normalizeLLMTextDeckSlides(plan: LLMTextDeckPlan): LLMTextDeckPlan['slides'] {
  const slides = plan.slides.map((slide, index) => {
    const title = cleanGeneratedText(slide.title, `第 ${index + 1} 页`).slice(0, 72)
    const points = slide.points
      .map((point) => cleanGeneratedText(point, ''))
      .filter((point) => point !== '' && point !== title)
      .slice(0, 4)
    const speakerNote = cleanGeneratedText(slide.speakerNote, [title, ...points].join('。'))
    const subtitle = cleanGeneratedText(slide.subtitle, '')

    return {
      ...slide,
      points,
      speakerNote,
      ...(subtitle === '' ? {} : {subtitle}),
      title,
    }
  }).filter((slide) => slide.title !== '' && slide.speakerNote !== '')

  return slides.length === 0
    ? [{
        motion: 'cinematic-rise',
        points: [],
        speakerNote: cleanGeneratedText(plan.summary, plan.title),
        title: cleanGeneratedText(plan.title, 'Deck Explainer'),
        type: 'hero',
      }]
    : slides
}

function createLLMTextDocument(
  inputPath: string,
  sourceText: string,
  deck: Deck,
  speakerScript: SpeakerScript,
  language: string,
  title: string,
  summary: string,
  sourceType: Document['source']['sourceType'] | undefined,
): Document {
  const sourceEvidence = truncateForLLM(stripMarkdownControlText(sourceText), 4000)

  return {
    blocks: deck.slides.map((slide, index): ContentBlock => {
      const script = speakerScript.segments[index]?.text
      const text = [slide.title, slide.subtitle, ...deckSlideContentParts(slide), script].filter((value): value is string => typeof value === 'string' && value.trim() !== '').join(' ')

      return {
        evidence: sourceEvidence === '' ? [] : [{ref: 'text-input', text: sourceEvidence, type: 'research'}],
        id: `block-${String(index + 1).padStart(3, '0')}`,
        text: text || slide.title,
        type: index === 0 ? 'summary' : contentBlockTypeForSlide(slide),
      }
    }),
    source: {
      language,
      path: inputPath,
      sourceType: sourceType ?? inferDocumentSourceType(inputPath),
      title,
    },
    text: [title, cleanGeneratedText(summary, ''), ...speakerScript.segments.map((segment) => segment.text)].filter(Boolean).join('\n\n'),
    version: 1,
  }
}

function contentBlockTypeForSlide(slide: Slide): ContentBlock['type'] {
  if (slide.type === 'quote') {
    return 'quote'
  }

  if (slide.type === 'cta') {
    return 'recommendation'
  }

  if (slide.type === 'summary') {
    return 'summary'
  }

  if (slide.type === 'chart' || slide.type === 'stat' || slide.type === 'timeline') {
    return 'data'
  }

  return 'claim'
}

function createDeckOutlineFromSlides(deck: Deck, language: string, title: string, durationTarget: number | undefined, audience: string | undefined): Outline {
  return {
    ...(audience === undefined ? {} : {audience: cleanGeneratedText(audience, '')}),
    durationTarget,
    language,
    sections: deck.slides.map((slide, index) => ({
      blockIds: slide.blockIds,
      duration: slide.duration,
      goal: slide.speakerNote ?? `Explain ${slide.title}.`,
      id: `section-${String(index + 1).padStart(3, '0')}`,
      title: slide.title,
    })),
    title,
    version: 1,
  }
}

function createDeckSelectedMoments(inputPath: string, deck: Deck, speakerScript: SpeakerScript, timings: SlideTiming[]): LongVideoSelectedMoments {
  return {
    moments: deck.slides.map((slide, index) => {
      const timing = timings[index] ?? {end: index + 1, slideId: slide.slideId, start: index}
      const script = speakerScript.segments[index]

      return {
        chunkId: 'text-000',
        evidence: slide.evidence,
        id: `text-slide-${String(index + 1).padStart(3, '0')}`,
        reason: 'LLM-planned text section converted into a slide explainer page.',
        score: 0.85,
        sourceRange: [timing.start, timing.end] as [number, number],
        summary: script?.text ?? slide.speakerNote ?? slide.title,
        title: slide.title,
      }
    }),
    source: inputPath,
    version: 1,
  }
}

function createDeckStoryboard(deck: Deck, speakerScript: SpeakerScript, timings: SlideTiming[], language: string): Storyboard {
  return {
    language,
    scenes: deck.slides.map((slide, index) => {
      const timing = timings[index] ?? {end: index + 1, slideId: slide.slideId, start: index}
      const script = speakerScript.segments[index]

      return {
        duration: Math.max(0.001, roundSeconds(timing.end - timing.start)),
        evidence: slide.evidence,
        id: `scene-${index + 1}`,
        narration: script?.text ?? slide.speakerNote ?? slide.title,
        sourceRange: [timing.start, timing.end] as [number, number],
        start: timing.start,
        visualStyle: 'slide_explainer',
      }
    }),
    targetPlatform: 'generic',
    version: 1,
  }
}

function createSlideTimingsFromSpeakerScript(speakerScript: SpeakerScript, durationTargetSeconds: number | undefined, fallbackSlideSeconds: number): SlideTiming[] {
  const segmentCount = Math.max(1, speakerScript.segments.length)
  const targetDuration = durationTargetSeconds === undefined ? undefined : Math.max(segmentCount * 2, durationTargetSeconds)
  let cursor = 0

  return speakerScript.segments.map((segment) => {
    const duration = targetDuration === undefined
      ? Math.max(2, segment.estimatedDuration ?? fallbackSlideSeconds)
      : targetDuration / segmentCount
    const start = roundSeconds(cursor)
    const end = roundSeconds(start + duration)

    cursor = end

    return {
      end,
      slideId: segment.slideId,
      start,
    }
  })
}

function createTextPlanQualityReport(input: {
  mediaInfo: MediaInfo
  narration: Narration
  selectedMoments: LongVideoSelectedMoments
  storyboard: Storyboard
  timeline: Timeline
}): TextDeckProjectPlan['qualityReport'] {
  const issues = createTextQualityIssues(input)

  return {
    checkedAt: new Date().toISOString(),
    issues,
    narrationSegments: input.narration.segments.length,
    summary: summarizeQualityIssues(issues),
    ttsSegments: 0,
    version: 1,
  }
}

function estimateTextDeckSlideCount(text: string, durationTargetSeconds: number | undefined): number {
  if (durationTargetSeconds !== undefined) {
    return clampInteger(Math.round(durationTargetSeconds / 22), 4, 14)
  }

  return clampInteger(Math.ceil(text.length / 900), 4, 12)
}

function estimateNarrationCharactersPerSlide(durationTargetSeconds: number | undefined, slideCount: number): number {
  if (durationTargetSeconds === undefined) {
    return 110
  }

  return clampInteger(Math.round(durationTargetSeconds / Math.max(1, slideCount) * 4.5), 60, 150)
}

function estimateNarrationDuration(text: string): number {
  return Math.max(4, Math.ceil(text.length / 12))
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function truncateForLLM(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text
  }

  return `${text.slice(0, maxCharacters)}\n\n[truncated ${text.length - maxCharacters} characters]`
}

function cleanGeneratedText(value: string | undefined, fallback: string): string {
  const cleaned = stripMarkdownControlText(value ?? '')
    .replaceAll(/^第\s*\d+\s*页[：:]\s*/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim()

  return cleaned === '' ? fallback : cleaned
}

function stripMarkdownControlText(value: string): string {
  return value
    .replaceAll(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n?/u, '')
    .replaceAll(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replaceAll(/```/g, '')
    .split('\n')
    .map((line) => line
      .replace(/^#{1,6}\s+/u, '')
      .replace(/^[-*+]\s+/u, '')
      .replace(/^>\s*/u, '')
      .replace(/\|/g, ' ')
      .trim())
    .filter((line) => line !== '---')
    .join('\n')
    .trim()
}

function createTextSlides(text: string, options: {maxSlideCharacters: number; title?: string}): TextSlide[] {
  const sections = splitTextSections(text, options.maxSlideCharacters)

  return sections.map((body, index) => ({
    body,
    index,
    title: index === 0 && options.title !== undefined ? options.title : createSlideTitle(body, index),
  }))
}

function splitTextSections(text: string, maxSlideCharacters: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/g)
    .map((paragraph) => normalizeText(paragraph))
    .filter(Boolean)
  const sections = (paragraphs.length === 0 ? [text] : paragraphs).flatMap((paragraph) => splitLongSection(paragraph, maxSlideCharacters))

  return sections.length === 0 ? [text] : sections
}

function splitLongSection(text: string, maxSlideCharacters: number): string[] {
  if (text.length <= maxSlideCharacters) {
    return [text]
  }

  const sentences = text
    .split(/(?<=[。！？.!?；;])\s*/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  const sections: string[] = []
  let current = ''

  for (const sentence of sentences.length === 0 ? [text] : sentences) {
    if (current !== '' && current.length + sentence.length > maxSlideCharacters) {
      sections.push(current)
      current = ''
    }

    if (sentence.length > maxSlideCharacters) {
      sections.push(...chunkByLength(sentence, maxSlideCharacters))
      continue
    }

    current = current === '' ? sentence : `${current} ${sentence}`
  }

  if (current !== '') {
    sections.push(current)
  }

  return sections
}

function chunkByLength(value: string, maxLength: number): string[] {
  const chunks: string[] = []

  for (let offset = 0; offset < value.length; offset += maxLength) {
    chunks.push(value.slice(offset, offset + maxLength))
  }

  return chunks
}

function createSlideTitle(body: string, index: number): string {
  const firstSentence = body.split(/[。.!！？?；;]/u)[0]?.trim()

  return firstSentence === undefined || firstSentence === '' ? `第 ${index + 1} 页` : firstSentence.slice(0, 36)
}

function createTextMediaInfo(inputPath: string, duration: number): MediaInfo {
  return {
    duration,
    formatName: 'text/plain',
    inputPath,
    probedAt: new Date().toISOString(),
    streams: [],
    version: 1,
  }
}

function createTextDocument(inputPath: string, text: string, slides: TextSlide[], language: string, title: string): Document {
  return {
    blocks: slides.map((slide) => createContentBlock(slide)),
    source: {
      language,
      path: inputPath,
      sourceType: inferDocumentSourceType(inputPath),
      title,
    },
    text,
    version: 1,
  }
}

function createSummarizedAudioDocument(inputPath: string, transcript: Transcript, text: string, slides: TextSlide[], language: string, title: string): Document {
  return {
    blocks: slides.map((slide) => ({
      ...createContentBlock(slide),
      evidence: [{ref: 'transcript.json', text: slide.body, type: 'asr' as const}],
    })),
    source: {
      language,
      path: inputPath,
      sourceType: 'audio',
      title,
    },
    text: text || transcript.text || slides.map((slide) => slide.body).join('\n\n'),
    version: 1,
  }
}

function createContentBlock(slide: TextSlide): ContentBlock {
  return {
    evidence: [{ref: 'text-input', text: slide.body, type: 'asr'}],
    id: `block-${String(slide.index + 1).padStart(3, '0')}`,
    text: slide.body,
    type: slide.index === 0 ? 'context' : 'claim',
  }
}

function inferDocumentSourceType(inputPath: string): Document['source']['sourceType'] {
  const extension = extname(inputPath).toLowerCase()

  if (extension === '.md' || extension === '.markdown') {
    return 'markdown'
  }

  if (extension === '.html' || extension === '.htm') {
    return 'html'
  }

  if (extension === '.pdf') {
    return 'pdf'
  }

  return 'text'
}

function isAudioInputPath(inputPath: string): boolean {
  return ['.aac', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.weba'].includes(extname(inputPath).toLowerCase())
}

function createTextOutline(slides: TextSlide[], language: string, title: string, durationTarget: number | undefined): Outline {
  return {
    durationTarget,
    language,
    sections: slides.map((slide) => ({
      blockIds: [`block-${String(slide.index + 1).padStart(3, '0')}`],
      goal: slide.index === 0 ? 'Introduce the topic and frame the explanation.' : 'Explain one content block clearly.',
      id: `section-${String(slide.index + 1).padStart(3, '0')}`,
      title: slide.title,
    })),
    title,
    version: 1,
  }
}

function createTextDeck(slides: TextSlide[], language: string, title: string, options: {format?: DeckFormat; theme?: string}): Deck {
  return {
    format: options.format ?? 'portrait_1080x1920',
    inputMode: 'script-generated',
    language,
    slides: slides.map((slide) => ({
      blockIds: [`block-${String(slide.index + 1).padStart(3, '0')}`],
      evidence: [{ref: `block-${String(slide.index + 1).padStart(3, '0')}`, text: slide.body, type: 'research'}],
      motion: slide.index === 0 ? 'cinematic-rise' : 'progressive-reveal',
      points: splitSlidePoints(slide.body),
      slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
      speakerNote: `第 ${slide.index + 1} 页：${slide.body}`,
      title: slide.title,
      type: slide.index === 0 ? 'hero' : 'three-points',
      visual: {
        assetRefs: [],
        kind: slide.index === 0 ? 'title-card' : 'text',
      },
    })),
    theme: normalizeDeckTheme(options.theme),
    title,
    version: 1,
  }
}

function splitSlidePoints(body: string): string[] {
  const sentences = body
    .split(/(?<=[。！？.!?；;])\s*/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  return (sentences.length === 0 ? [body] : sentences).slice(0, 4)
}

function normalizeDeckTheme(theme: string | undefined): Deck['theme'] {
  if (theme === undefined || theme === 'auto') {
    return DEFAULT_DECK_THEME
  }

  if (DECK_THEMES.includes(theme as Deck['theme'])) {
    return theme as Deck['theme']
  }

  throw new Error(`Unsupported deck theme "${theme}". Expected one of: ${DECK_THEMES.join(', ')}.`)
}

function resolveTheme(llmTheme: string | undefined, optionTheme: string | undefined): Deck['theme'] {
  if (optionTheme !== undefined && optionTheme !== 'auto') {
    return normalizeDeckTheme(optionTheme)
  }

  if (llmTheme !== undefined && DECK_THEMES.includes(llmTheme as Deck['theme'])) {
    return llmTheme as Deck['theme']
  }

  return DEFAULT_DECK_THEME
}

function defaultSlideMotion(index: number, type: DeckSlideType | undefined): Slide['motion'] {
  if (index === 0 || type === 'hero') {
    return 'cinematic-rise'
  }

  if (type === 'comparison') {
    return 'card-stack'
  }

  if (type === 'timeline' || type === 'process') {
    return 'progressive-reveal'
  }

  if (type === 'stat') {
    return 'number-count'
  }

  return 'progressive-reveal'
}

function visualKindForSlideType(type: DeckSlideType): DeckVisual['kind'] {
  if (type === 'hero') {
    return 'title-card'
  }

  if (type === 'chart' || type === 'stat') {
    return 'chart'
  }

  if (type === 'code') {
    return 'code'
  }

  if (type === 'process' || type === 'timeline') {
    return 'process'
  }

  return 'text'
}

function createTextSpeakerScript(slides: TextSlide[], language: string): SpeakerScript {
  return {
    language,
    mode: 'script-generated',
    segments: slides.map((slide) => ({
      estimatedDuration: Math.max(4, Math.ceil(slide.body.length / 12)),
      slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
      text: `第 ${slide.index + 1} 页：${slide.body}`,
    })),
    version: 1,
  }
}

function createSlideTimings(slides: TextSlide[], slideSeconds: number): SlideTiming[] {
  return slides.map((slide) => ({
    end: (slide.index + 1) * slideSeconds,
    slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
    start: slide.index * slideSeconds,
  }))
}

function createTimedDeck(deck: Deck, timings: SlideTiming[]): TimedDeck {
  return {
    deck,
    timings,
    version: 1,
  }
}

function createTextSelectedMoments(inputPath: string, slides: TextSlide[], slideSeconds: number): LongVideoSelectedMoments {
  return {
    moments: slides.map((slide) => ({
      chunkId: 'text-000',
      evidence: [{ref: 'text-input', text: slide.body, type: 'asr' as const}],
      id: `text-slide-${String(slide.index + 1).padStart(3, '0')}`,
      reason: 'Text section converted into a slide explainer page.',
      score: 0.8,
      sourceRange: [slide.index * slideSeconds, (slide.index + 1) * slideSeconds],
      summary: `第 ${slide.index + 1} 页：${slide.body}`,
      title: slide.title,
    })),
    source: inputPath,
    version: 1,
  }
}

function createTextStoryboard(slides: TextSlide[], slideSeconds: number, language: string): Storyboard {
  return {
    language,
    scenes: slides.map((slide) => ({
      duration: slideSeconds,
      evidence: [{ref: 'text-input', text: slide.body, type: 'asr'}],
      id: `scene-${slide.index + 1}`,
      narration: `第 ${slide.index + 1} 页：${slide.body}`,
      sourceRange: [slide.index * slideSeconds, (slide.index + 1) * slideSeconds],
      start: slide.index * slideSeconds,
      visualStyle: 'slide_explainer',
    })),
    targetPlatform: 'generic',
    version: 1,
  }
}

function createTextTimeline(duration: number): Timeline {
  return {
    duration,
    fps: 30,
    items: [],
    version: 1,
  }
}

function createTextNarration(storyboard: Storyboard, slides: TextSlide[], language: string): Narration {
  return {
    language,
    segments: storyboard.scenes.map((scene, index) => ({
      duration: scene.duration,
      id: `narration-${index + 1}`,
      sceneId: scene.id,
      start: scene.start,
      text: `第 ${index + 1} 页：${slides[index]?.body ?? scene.narration ?? scene.id}`,
    })),
    version: 1,
  }
}

function createDeckNarrationFromSpeakerScript(speakerScript: SpeakerScript, timedDeck: TimedDeck): Narration {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))

  return {
    language: speakerScript.language,
    segments: speakerScript.segments.map((segment, index) => {
      const timing = timingBySlide.get(segment.slideId)

      return {
        duration: segment.estimatedDuration ?? (timing === undefined ? 1 : Math.max(0.1, timing.end - timing.start)),
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing?.start ?? index,
        text: segment.text,
      }
    }),
    version: 1,
  }
}

function createSlideTimingsFromTts(speakerScript: SpeakerScript, timedDeck: TimedDeck, ttsSegments: TTSSegment[]): SlideTiming[] {
  let cursor = 0

  return speakerScript.segments.map((segment, index) => {
    const fallbackTiming = timedDeck.timings.find((timing) => timing.slideId === segment.slideId)
    const fallbackDuration = segment.estimatedDuration ?? (fallbackTiming === undefined ? 1 : fallbackTiming.end - fallbackTiming.start)
    const duration = roundSeconds(Math.max(0.1, ttsSegments[index]?.duration ?? fallbackDuration))
    const start = roundSeconds(cursor)
    const end = roundSeconds(start + duration)

    cursor = end

    return {
      end,
      slideId: segment.slideId,
      start,
    }
  })
}

function createDeckNarrationFromTimings(speakerScript: SpeakerScript, timings: SlideTiming[]): Narration {
  const timingBySlide = new Map(timings.map((timing) => [timing.slideId, timing]))

  return {
    language: speakerScript.language,
    segments: speakerScript.segments.map((segment, index) => {
      const timing = timingBySlide.get(segment.slideId)

      return {
        duration: timing === undefined ? segment.estimatedDuration ?? 1 : roundSeconds(timing.end - timing.start),
        id: `narration-${index + 1}`,
        sceneId: `scene-${index + 1}`,
        start: timing?.start ?? index,
        text: segment.text,
      }
    }),
    version: 1,
  }
}

function updateStoryboardTiming(storyboard: Storyboard, narration: Narration, timings: SlideTiming[]): Storyboard {
  return {
    ...storyboard,
    scenes: storyboard.scenes.map((scene, index) => {
      const timing = timings[index]
      const narrationSegment = narration.segments[index]

      if (timing === undefined) {
        return scene
      }

      return {
        ...scene,
        duration: roundSeconds(timing.end - timing.start),
        narration: narrationSegment?.text ?? scene.narration,
        sourceRange: [timing.start, timing.end],
        start: timing.start,
      }
    }),
  }
}

function updateSelectedMomentsTiming(selectedMoments: LongVideoSelectedMoments, timings: SlideTiming[]): LongVideoSelectedMoments {
  return {
    ...selectedMoments,
    moments: selectedMoments.moments.map((moment, index) => {
      const timing = timings[index]

      return timing === undefined ? moment : {
        ...moment,
        sourceRange: [timing.start, timing.end],
      }
    }),
  }
}

async function renderDeckVoiceover(projectDir: string, ttsSegments: TTSSegment[], outputPath: string): Promise<void> {
  if (ttsSegments.length === 0) {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      '0.1',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return
  }

  const inputArgs = ttsSegments.flatMap((segment) => ['-i', resolve(projectDir, segment.path)])
  const concatInputs = ttsSegments.map((_, index) => `[${index}:a]`).join('')

  await runFfmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex',
    `${concatInputs}concat=n=${ttsSegments.length}:v=0:a=1[aout]`,
    '-map',
    '[aout]',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ])
}

interface DeckFrame {
  duration: number
  path: string
  slideId: string
}

async function renderDeckFrameClips(frames: DeckHtmlFrame[], clipsDir: string): Promise<DeckFrame[]> {
  await mkdir(clipsDir, {recursive: true})

  return Promise.all(frames.map((frame, index) => renderDeckFrameClip(frame, resolve(clipsDir, `slide-${String(index + 1).padStart(3, '0')}.mp4`))))
}

async function renderDeckFrameClip(frame: DeckHtmlFrame, outputPath: string): Promise<DeckFrame> {
  await runFfmpeg([
    '-y',
    '-loop',
    '1',
    '-t',
    String(frame.duration),
    '-i',
    frame.path,
    '-an',
    '-vf',
    'format=yuv420p',
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'stillimage',
    '-movflags',
    '+faststart',
    outputPath,
  ])

  return {
    duration: frame.duration,
    path: outputPath,
    slideId: frame.slideId,
  }
}

async function writeDeckClipConcatList(clips: DeckFrame[], outputPath: string): Promise<void> {
  const lines = clips.map((clip) => `file '${escapeFfmpegConcatPath(clip.path)}'`)

  await bunWrite(outputPath, `${lines.join('\n')}\n`)
}

async function concatDeckFrameClips(concatPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outputPath,
  ])
}

async function muxDeckFinalVideo(silentVideoPath: string, audioPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    silentVideoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  ])
}

function escapeFfmpegConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''")
}

async function inspectDeckRenderedOutput(outputPath: string, options: {expectedDuration: number}) {
  try {
    return checkRenderedMedia(await probeMedia(outputPath), {
      expectAudio: true,
      expectedDuration: options.expectedDuration,
    })
  } catch (error) {
    return createRenderedMediaProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

function toProjectPath(projectDir: string, path: string): string {
  return path.startsWith(`${projectDir}/`) ? path.slice(projectDir.length + 1) : path
}

function createTextQualityIssues(input: {
  mediaInfo: MediaInfo
  narration: Narration
  selectedMoments: LongVideoSelectedMoments
  storyboard: Storyboard
  timeline: Timeline
}): QualityIssue[] {
  return [
    ...checkStoryboardConsistency(input.storyboard, input.mediaInfo),
    ...checkTimelineBounds(input.timeline),
    ...checkNarrationTiming(input.narration, input.timeline),
    ...checkExplainerStructure(input),
  ]
}

function createClaimsFromDocument(document: Document): Claims {
  const claimBlocks = document.blocks.filter((block) => ['claim', 'data', 'recommendation', 'summary'].includes(block.type))

  return {
    claims: claimBlocks.map((block, index): Claim => ({
      blockId: block.id,
      confidence: confidenceForContentBlock(block),
      evidence: block.evidence,
      id: `claim-${String(index + 1).padStart(3, '0')}`,
      text: block.text,
      type: block.type as Claim['type'],
    })),
    version: 1,
  }
}

function createSourceQuotesFromDocument(document: Document): SourceQuotes {
  return {
    quotes: document.blocks.map((block, index): SourceQuote => ({
      blockId: block.id,
      evidence: block.evidence,
      id: `quote-${String(index + 1).padStart(3, '0')}`,
      ...(block.sourceRange === undefined ? {} : {sourceRange: block.sourceRange}),
      text: block.text,
    })),
    version: 1,
  }
}

function confidenceForContentBlock(block: ContentBlock): number {
  if (block.evidence.length > 0) {
    return 0.9
  }

  if (block.type === 'data') {
    return 0.8
  }

  if (block.type === 'summary') {
    return 0.75
  }

  return 0.7
}

function createDeckQualityReport(timedDeck: TimedDeck): DeckQualityReport {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const issues: DeckQualityIssue[] = []
  const metrics = timedDeck.deck.slides.map((slide) => {
    const timing = timingBySlide.get(slide.slideId)
    const duration = timing === undefined ? 0 : roundSeconds(timing.end - timing.start)
    const metric = createDeckSlideQualityMetrics(slide, duration)

    issues.push(...createDeckSlideQualityIssues(slide, metric, timedDeck.deck.format))

    if (timing === undefined) {
      issues.push({
        code: 'deck.slide_timing_missing',
        message: `Slide ${slide.slideId} has no timing entry.`,
        severity: 'error',
        slideId: slide.slideId,
      })
    }

    return metric
  })

  issues.push(...createDeckTimingQualityIssues(timedDeck.timings))
  issues.push(...createDuplicateSlideQualityIssues(timedDeck.deck.slides))

  return {
    checkedAt: new Date().toISOString(),
    format: timedDeck.deck.format,
    issues,
    metrics,
    source: 'timed-deck.json',
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      slides: timedDeck.deck.slides.length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
    version: 1,
  }
}

function createDeckSlideQualityMetrics(slide: Slide, duration: number): DeckSlideQualityMetrics {
  const textCharacters = deckSlideText(slide).length

  return {
    duration,
    estimatedCharactersPerSecond: duration <= 0 ? 0 : roundSeconds(textCharacters / duration),
    pointCount: slide.points.length,
    slideId: slide.slideId,
    textCharacters,
    titleCharacters: slide.title.length,
  }
}

function createDeckSlideQualityIssues(slide: Slide, metric: DeckSlideQualityMetrics, format: DeckFormat): DeckQualityIssue[] {
  const issues: DeckQualityIssue[] = []
  const maxTitleCharacters = format === 'portrait_1080x1920' ? 34 : 48
  const maxTextCharacters = format === 'portrait_1080x1920' ? 180 : 240

  if (metric.titleCharacters > maxTitleCharacters) {
    issues.push({
      code: 'deck.title_too_long',
      message: `Slide ${slide.slideId} title has ${metric.titleCharacters} characters; target is ${maxTitleCharacters} or fewer for ${format}.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.textCharacters > maxTextCharacters) {
    issues.push({
      code: 'deck.text_density_high',
      message: `Slide ${slide.slideId} has ${metric.textCharacters} text characters; target is ${maxTextCharacters} or fewer for ${format}.`,
      severity: metric.textCharacters > maxTextCharacters * 1.5 ? 'error' : 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.pointCount > 4) {
    issues.push({
      code: 'deck.too_many_points',
      message: `Slide ${slide.slideId} has ${metric.pointCount} points; target is 4 or fewer.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.duration > 0 && metric.duration < 2) {
    issues.push({
      code: 'deck.slide_too_short',
      message: `Slide ${slide.slideId} duration is ${metric.duration}s; target is at least 2s for readability.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  if (metric.estimatedCharactersPerSecond > 18) {
    issues.push({
      code: 'deck.reading_rate_high',
      message: `Slide ${slide.slideId} has an estimated reading rate of ${metric.estimatedCharactersPerSecond} characters/s.`,
      severity: metric.estimatedCharactersPerSecond > 28 ? 'error' : 'warning',
      slideId: slide.slideId,
    })
  }

  if (slide.type === 'chart' && slide.visual?.chartDataRef === undefined && slide.evidence.length === 0) {
    issues.push({
      code: 'deck.chart_missing_source',
      message: `Slide ${slide.slideId} is a chart slide without chartDataRef or evidence.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  return issues
}

function createDeckTimingQualityIssues(timings: SlideTiming[]): DeckQualityIssue[] {
  const issues: DeckQualityIssue[] = []
  const sorted = [...timings].sort((left, right) => left.start - right.start)

  sorted.forEach((timing, index) => {
    const previous = sorted[index - 1]

    if (previous !== undefined && timing.start < previous.end) {
      issues.push({
        code: 'deck.timing_overlap',
        message: `Slide ${timing.slideId} starts before the previous slide ends.`,
        severity: 'error',
        slideId: timing.slideId,
      })
    }

    if (previous !== undefined && timing.start - previous.end > 0.25) {
      issues.push({
        code: 'deck.timing_gap',
        message: `Slide ${timing.slideId} starts ${roundSeconds(timing.start - previous.end)}s after the previous slide ends.`,
        severity: 'warning',
        slideId: timing.slideId,
      })
    }
  })

  return issues
}

function createDuplicateSlideQualityIssues(slides: Slide[]): DeckQualityIssue[] {
  const seen = new Map<string, string>()
  const issues: DeckQualityIssue[] = []

  for (const slide of slides) {
    const key = deckSlideText(slide).toLowerCase()
    const previousSlideId = seen.get(key)

    if (previousSlideId !== undefined) {
      issues.push({
        code: 'deck.duplicate_slide',
        message: `Slide ${slide.slideId} duplicates the visible text of ${previousSlideId}.`,
        severity: 'warning',
        slideId: slide.slideId,
      })
    } else {
      seen.set(key, slide.slideId)
    }
  }

  return issues
}

function deckSlideText(slide: Slide): string {
  return [slide.title, slide.subtitle, ...deckSlideContentParts(slide)].filter((value): value is string => value !== undefined).join(' ').trim()
}

function deckSlideContentParts(slide: Slide): string[] {
  return [
    ...slide.points,
    ...(slide.comparison === undefined ? [] : [
      slide.comparison.left.label,
      ...slide.comparison.left.points,
      slide.comparison.right.label,
      ...slide.comparison.right.points,
    ]),
    ...(slide.quote === undefined ? [] : [slide.quote.text, slide.quote.attribution].filter((value): value is string => value !== undefined)),
    ...(slide.stat === undefined ? [] : [slide.stat.value, slide.stat.label, slide.stat.caption].filter((value): value is string => value !== undefined)),
    ...(slide.code === undefined ? [] : [slide.code.language, slide.code.text]),
  ]
}

function summarizeQualityIssues(issues: QualityIssue[]): {errors: number; warnings: number} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

function normalizeText(value: string): string {
  return value.replaceAll(/\r\n?/g, '\n').replaceAll(/[ \t]+/g, ' ').trim()
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

import type {Claim, Claims, ContentBlock, Deck, DeckFormat, DeckQualityIssue, DeckQualityReport, DeckSlideQualityMetrics, Document, LongVideoSelectedMoments, MediaInfo, Narration, Outline, Slide, SlideTiming, SourceQuote, SourceQuotes, SpeakerScript, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {Transcript, TTSSegment} from '@video-agent/providers'
import type {QualityIssue} from '@video-agent/quality'
import type {HyperframesCliResult} from '@video-agent/renderer-hyperframes'

import {JsonJobStore} from '@video-agent/db'
import {ClaimsSchema, ContentBlocksSchema, DeckQualityReportSchema, DeckSchema, DocumentSchema, NarrationSchema, OutlineSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema, TimelineSchema} from '@video-agent/ir'
import {probeMedia, runFfmpeg} from '@video-agent/media'
import {createProviders, TranscriptSchema, TtsSegmentsSchema} from '@video-agent/providers'
import {checkExplainerStructure, checkNarrationTiming, checkRenderedMedia, checkStoryboardConsistency, checkTimelineBounds, createRenderedMediaProbeFailure} from '@video-agent/quality'
import {writeDeckHtmlProject} from '@video-agent/renderer-html'
import {renderHyperframesProject, validateHyperframesProject} from '@video-agent/renderer-hyperframes'
import {mkdir} from 'node:fs/promises'
import {extname, join, resolve} from 'node:path'

import {refreshArtifactManifest} from './artifact-store.js'
import {bunFile, bunWrite} from './bun-runtime.js'
import {readConfig} from './config.js'
import {assertFileExists} from './file-io.js'
import {createProjectWorkspace} from './workspace.js'

export interface CreateTextExplainerProjectOptions {
  deckFormat?: DeckFormat
  durationTargetSeconds?: number
  inputPath: string
  language?: string
  maxSlideCharacters?: number
  projectId?: string
  slideSeconds?: number
  theme?: string
  title?: string
  workspaceDir?: string
}

export interface CreateTextExplainerProjectResult {
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
  videoRenderer: 'ffmpeg'
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

export interface CreateDeckAudioSummaryProjectResult extends CreateTextExplainerProjectResult {
  artifacts: CreateTextExplainerProjectResult['artifacts'] & {
    transcript: string
  }
  sourceMode: 'audio-summary'
}

export type CreateDeckSummarizeProjectResult = CreateTextExplainerProjectResult | CreateDeckAudioSummaryProjectResult

const DEFAULT_MAX_SLIDE_CHARACTERS = 260
const DEFAULT_SLIDE_SECONDS = 18
const DECK_AUDIO_ANCHORED_STAGES = ['ingest', 'transcribe', 'plan', 'align', 'quality'] as const
const DECK_SUMMARIZE_STAGES = ['ingest', 'transcribe', 'understand', 'plan', 'script', 'quality'] as const
const DECK_STAGES = ['ingest', 'understand', 'plan', 'script', 'synthesize-voice', 'update-timing', 'render-final', 'quality'] as const

export async function createTextExplainerProject(options: CreateTextExplainerProjectOptions): Promise<CreateTextExplainerProjectResult> {
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
  const slideSeconds = options.slideSeconds ?? DEFAULT_SLIDE_SECONDS
  const slides = createTextSlides(text, {
    maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
    title: options.title,
  })
  const title = options.title ?? slides[0]?.title ?? 'Deck Explainer'
  const deckSlideSeconds = options.durationTargetSeconds === undefined ? slideSeconds : Math.max(1, options.durationTargetSeconds / Math.max(1, slides.length))
  const mediaInfo = createTextMediaInfo(inputPath, slides.length * deckSlideSeconds)
  const selectedMoments = createTextSelectedMoments(inputPath, slides, deckSlideSeconds)
  const document = DocumentSchema.parse(createTextDocument(inputPath, text, slides, language, title))
  const contentBlocks = ContentBlocksSchema.parse({
    blocks: document.blocks,
    version: 1,
  })
  const claims = ClaimsSchema.parse(createClaimsFromDocument(document))
  const sourceQuotes = SourceQuotesSchema.parse(createSourceQuotesFromDocument(document))
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
    slides: slides.length,
    status: 'completed',
  }
}

export interface CreateDeckExplainerProjectOptions extends CreateTextExplainerProjectOptions {
  mode?: 'script-generated'
}

export async function createDeckExplainerProject(options: CreateDeckExplainerProjectOptions): Promise<CreateTextExplainerProjectResult> {
  return createTextExplainerProject(options)
}

export async function createDeckSummarizeProject(options: CreateTextExplainerProjectOptions): Promise<CreateDeckSummarizeProjectResult> {
  const inputPath = resolve(options.inputPath)

  if (!isAudioInputPath(inputPath)) {
    return createTextExplainerProject(options)
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
    const providers = createProviders(config)

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
    const providers = createProviders(config)

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
    const providers = createProviders(config)
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
    const htmlOutputDir = resolve(workspace.rendersDir, 'html')
    const htmlRenderedOutputPath = resolve(options.htmlOutput ?? resolve(workspace.rendersDir, 'deck_html_capture.mp4'))
    const concatPath = resolve(framesDir, 'frames.txt')
    const silentVideoPath = resolve(workspace.rendersDir, 'deck_silent.mp4')
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')

    await assertFileExists(audioPath)
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
    const frames = await writeDeckFrameImages(timedDeck, framesDir)

    await writeDeckFrameConcatList(frames, concatPath)
    await renderDeckSilentVideo(concatPath, silentVideoPath)
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
      frameCount: frames.length,
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
      videoRenderer: 'ffmpeg' as const,
    })

    await jobStore.updateStage('render-final', 'completed', undefined, 1)
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      audioPath,
      deckQualityReportPath,
      frameCount: frames.length,
      htmlEntryPath: htmlProject.entryHtml,
      htmlOutputDir: htmlProject.outputDir,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      ...(rendered === undefined ? {} : {rendered}),
      renderer: 'html',
      status: 'rendered',
      ...(validation === undefined ? {} : {validation}),
      videoRenderer: 'ffmpeg',
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
      bullets: splitSlideBullets(slide.body),
      duration: roundSeconds(slide.end - slide.start),
      evidence: [{ref: `transcript.json#${slide.index}`, text: slide.body, type: 'asr'}],
      slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
      speakerNote: slide.body,
      title: slide.index === 0 ? title : slide.title,
      type: slide.index === 0 ? 'title' : 'bullet',
      visual: {
        assetRefs: [],
        kind: slide.index === 0 ? 'title-card' : 'text',
      },
    })),
    theme: options.theme ?? 'default',
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
      bullets: splitSlideBullets(slide.body),
      evidence: [{ref: `block-${String(slide.index + 1).padStart(3, '0')}`, text: slide.body, type: 'research'}],
      slideId: `slide-${String(slide.index + 1).padStart(3, '0')}`,
      speakerNote: `第 ${slide.index + 1} 页：${slide.body}`,
      title: slide.title,
      type: slide.index === 0 ? 'title' : 'bullet',
      visual: {
        assetRefs: [],
        kind: slide.index === 0 ? 'title-card' : 'text',
      },
    })),
    theme: options.theme ?? 'default',
    title,
    version: 1,
  }
}

function splitSlideBullets(body: string): string[] {
  const sentences = body
    .split(/(?<=[。！？.!?；;])\s*/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  return (sentences.length === 0 ? [body] : sentences).slice(0, 4)
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
}

async function writeDeckFrameImages(timedDeck: TimedDeck, framesDir: string): Promise<DeckFrame[]> {
  const size = deckRenderSize(timedDeck.deck.format)
  const timingsBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const frames = timedDeck.deck.slides.map((slide, index) => {
    const timing = timingsBySlide.get(slide.slideId)
    const duration = Math.max(0.1, timing === undefined ? slide.duration ?? 1 : timing.end - timing.start)
    const path = resolve(framesDir, `slide-${String(index + 1).padStart(3, '0')}.ppm`)

    return {
      duration,
      image: renderDeckSlideFrame({
        bullets: slide.bullets,
        index,
        size,
        subtitle: slide.subtitle,
        theme: timedDeck.deck.theme,
        title: slide.title,
        total: timedDeck.deck.slides.length,
      }),
      path,
    }
  })

  await Promise.all(frames.map((frame) => bunWrite(frame.path, frame.image)))

  return frames.map(({duration, path}) => ({duration, path}))
}

async function writeDeckFrameConcatList(frames: DeckFrame[], outputPath: string): Promise<void> {
  const lines = frames.flatMap((frame, index) => [
    `file '${frame.path.replaceAll("'", "'\\''")}'`,
    `duration ${frame.duration}`,
    ...(index === frames.length - 1 ? [`file '${frame.path.replaceAll("'", "'\\''")}'`] : []),
  ])

  await bunWrite(outputPath, `${lines.join('\n')}\n`)
}

async function renderDeckSilentVideo(concatPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-vsync',
    'vfr',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
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
    outputPath,
  ])
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

function deckRenderSize(format: DeckFormat): {height: number; width: number} {
  if (format === 'landscape_1920x1080') {
    return {height: 1080, width: 1920}
  }

  if (format === 'square_1080x1080') {
    return {height: 1080, width: 1080}
  }

  return {height: 1920, width: 1080}
}

function renderDeckSlideFrame(input: {
  bullets: string[]
  index: number
  size: {height: number; width: number}
  subtitle?: string
  theme: string
  title: string
  total: number
}): Uint8Array {
  const image = createRgbImage(input.size.width, input.size.height, [245, 247, 250])
  const accent = themeAccent(input.theme)
  const margin = Math.round(input.size.width * 0.07)
  const top = Math.round(input.size.height * 0.08)
  const cardWidth = input.size.width - margin * 2
  const cardHeight = input.size.height - top * 2

  fillRect(image, 0, 0, input.size.width, input.size.height, [239, 244, 248])
  fillRect(image, margin, top, cardWidth, cardHeight, [255, 255, 255])
  fillRect(image, margin, top, 16, cardHeight, accent)
  fillRect(image, margin, top, cardWidth, 4, [210, 218, 229])
  drawText(image, `SLIDE ${input.index + 1}/${input.total}`, margin + 48, top + 58, 5, accent)
  drawWrappedText(image, asciiText(input.title, `Slide ${input.index + 1}`), margin + 48, top + 150, cardWidth - 96, 9, [15, 23, 42], 3)

  const bullets = input.bullets.length === 0 ? [input.subtitle ?? input.title] : input.bullets
  const bulletTop = Math.round(top + cardHeight * 0.48)

  bullets.slice(0, 4).forEach((bullet, index) => {
    const y = bulletTop + index * Math.round(input.size.height * 0.095)

    fillRect(image, margin + 58, y - 24, 14, 14, accent)
    drawWrappedText(image, asciiText(bullet, `Content point ${index + 1}`), margin + 96, y - 36, cardWidth - 150, 5, [31, 41, 55], 2)
  })

  const footer = asciiText(input.theme, 'default')

  drawText(image, footer.toUpperCase(), margin + 48, top + cardHeight - 86, 4, [100, 116, 139])

  return encodePpm(image)
}

interface RgbImage {
  data: Uint8Array
  height: number
  width: number
}

function createRgbImage(width: number, height: number, color: [number, number, number]): RgbImage {
  const image = {
    data: new Uint8Array(width * height * 3),
    height,
    width,
  }

  fillRect(image, 0, 0, width, height, color)

  return image
}

function fillRect(image: RgbImage, x: number, y: number, width: number, height: number, color: [number, number, number]): void {
  const startX = Math.max(0, Math.floor(x))
  const startY = Math.max(0, Math.floor(y))
  const endX = Math.min(image.width, Math.ceil(x + width))
  const endY = Math.min(image.height, Math.ceil(y + height))

  for (let row = startY; row < endY; row += 1) {
    for (let column = startX; column < endX; column += 1) {
      setPixel(image, column, row, color)
    }
  }
}

function setPixel(image: RgbImage, x: number, y: number, color: [number, number, number]): void {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    return
  }

  const offset = (y * image.width + x) * 3

  image.data[offset] = color[0]
  image.data[offset + 1] = color[1]
  image.data[offset + 2] = color[2]
}

function drawWrappedText(image: RgbImage, text: string, x: number, y: number, maxWidth: number, scale: number, color: [number, number, number], maxLines: number): void {
  const words = text.split(/\s+/).filter(Boolean)
  const lineCapacity = Math.max(1, Math.floor(maxWidth / (6 * scale)))
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`

    if (candidate.length > lineCapacity && current !== '') {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }

    if (lines.length >= maxLines) {
      break
    }
  }

  if (current !== '' && lines.length < maxLines) {
    lines.push(current)
  }

  lines.forEach((line, index) => drawText(image, line, x, y + index * scale * 9, scale, color))
}

function drawText(image: RgbImage, text: string, x: number, y: number, scale: number, color: [number, number, number]): void {
  const chars = text.toUpperCase().split('')

  chars.forEach((char, index) => drawChar(image, char, x + index * scale * 6, y, scale, color))
}

function drawChar(image: RgbImage, char: string, x: number, y: number, scale: number, color: [number, number, number]): void {
  const bitmap = FONT_5X7[char] ?? FONT_5X7['?']

  bitmap.forEach((row, rowIndex) => {
    for (let column = 0; column < row.length; column += 1) {
      if (row[column] === '1') {
        fillRect(image, x + column * scale, y + rowIndex * scale, scale, scale, color)
      }
    }
  })
}

function encodePpm(image: RgbImage): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${image.width} ${image.height}\n255\n`)
  const output = new Uint8Array(header.length + image.data.length)

  output.set(header, 0)
  output.set(image.data, header.length)

  return output
}

function asciiText(value: string | undefined, fallback: string): string {
  const ascii = (value ?? '').replaceAll(/[^\x20-\x7E]+/g, ' ').replaceAll(/\s+/g, ' ').trim()

  return ascii === '' ? fallback : ascii
}

function themeAccent(theme: string): [number, number, number] {
  if (theme.toLowerCase().includes('tech')) {
    return [37, 99, 235]
  }

  if (theme.toLowerCase().includes('dark')) {
    return [20, 184, 166]
  }

  return [249, 115, 22]
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
    bulletCount: slide.bullets.length,
    duration,
    estimatedCharactersPerSecond: duration <= 0 ? 0 : roundSeconds(textCharacters / duration),
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

  if (metric.bulletCount > 6) {
    issues.push({
      code: 'deck.too_many_bullets',
      message: `Slide ${slide.slideId} has ${metric.bulletCount} bullets; target is 6 or fewer.`,
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
  return [slide.title, slide.subtitle, ...slide.bullets].filter((value): value is string => value !== undefined).join(' ').trim()
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

const FONT_5X7: Record<string, string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '01000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00001', '00001', '00001', '00001', '10001', '10001', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
}

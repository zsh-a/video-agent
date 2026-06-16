import type {LongVideoSelectedMoments, MediaInfo, Narration, Storyboard, Timeline} from '@video-agent/ir'
import type {QualityIssue} from '@video-agent/quality'

import {JsonJobStore} from '@video-agent/db'
import {NarrationSchema, StoryboardSchema, TimelineSchema} from '@video-agent/ir'
import {checkExplainerStructure, checkNarrationTiming, checkStoryboardConsistency, checkTimelineBounds} from '@video-agent/quality'
import {resolve} from 'node:path'

import {refreshArtifactManifest} from './artifact-store.js'
import {bunFile} from './bun-runtime.js'
import {assertFileExists} from './file-io.js'
import {createProjectWorkspace} from './workspace.js'

export interface CreateTextExplainerProjectOptions {
  inputPath: string
  language?: string
  maxSlideCharacters?: number
  projectId?: string
  slideSeconds?: number
  title?: string
  workspaceDir?: string
}

export interface CreateTextExplainerProjectResult {
  artifacts: {
    mediaInfo: string
    narration: string
    qualityReport: string
    selectedMoments: string
    storyboard: string
    timeline: string
  }
  projectDir: string
  projectId: string
  slides: number
  status: 'completed'
}

const DEFAULT_MAX_SLIDE_CHARACTERS = 260
const DEFAULT_SLIDE_SECONDS = 18

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
  const mediaInfo = createTextMediaInfo(inputPath, slides.length * slideSeconds)
  const selectedMoments = createTextSelectedMoments(inputPath, slides, slideSeconds)
  const storyboard = StoryboardSchema.parse(createTextStoryboard(slides, slideSeconds, language))
  const timeline = TimelineSchema.parse(createTextTimeline(slides.length * slideSeconds))
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
    stages: ['ingest', 'understand', 'plan', 'script', 'quality'],
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

interface TextSlide {
  body: string
  index: number
  title: string
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

function summarizeQualityIssues(issues: QualityIssue[]): {errors: number; warnings: number} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

function normalizeText(value: string): string {
  return value.replaceAll(/\r\n?/g, '\n').replaceAll(/[ \t]+/g, ' ').trim()
}

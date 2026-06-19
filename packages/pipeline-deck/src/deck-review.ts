import type {DeckFormat, DeckQualityReport, DeckSlideType, Slide, SlideTiming, TimedDeck} from '@video-agent/ir'
import type {RenderedMediaQualityResult, SubtitleQualityResult, VisualFrameSample, VisualSmokeQualityResult} from '@video-agent/quality'
import type {DeckHtmlKeyframeCaptureBackend} from '@video-agent/renderer-html'

import {mkdir, rm} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunWrite, type ProjectWorkspace} from '@video-agent/runtime'

export const DECK_REVIEW_FRAME_RENDERER = 'remotion'
export const DEFAULT_DECK_REVIEW_FRAME_CONCURRENCY = 4

export type DeckReviewFrameRenderer = DeckHtmlKeyframeCaptureBackend | typeof DECK_REVIEW_FRAME_RENDERER
export type DeckReviewVideoRenderer = 'chromium+ffmpeg' | 'playwright+ffmpeg' | 'remotion+ffmpeg'

export interface DeckReviewArtifacts {
  htmlPath: string
  report: DeckReviewReportArtifact
  reportPath: string
}

export interface DeckReviewReportArtifact {
  duration: number
  format: DeckFormat
  generatedAt: string
  keyframeQualityPath: string
  outputPath: string
  projectId: string
  renderer: DeckReviewFrameRenderer
  reviewHtmlPath: string
  slides: DeckReviewSlideReport[]
  source: 'timed-deck.json'
  summary: {
    deckErrors: number
    deckWarnings: number
    keyframes: number
    outputErrors: number
    outputWarnings: number
    slides: number
    subtitleErrors: number
    subtitleWarnings: number
    visualErrors: number
    visualWarnings: number
  }
  title: string
  version: 1
  videoRenderer: DeckReviewVideoRenderer
}

export interface DeckReviewSlideReport {
  duration: number
  end: number
  index: number
  keyframe?: {
    error?: string
    ok: boolean
    path: string
    sha256?: string
    size?: number
    time: number
  }
  points?: string[]
  slideId: string
  speakerNote?: string
  start: number
  title: string
  type: DeckSlideType
}

export interface DeckKeyframeArtifact {
  captureMode: 'browser-keyframes' | 'final-video' | 'frame-sequence'
  duration: number
  fps: number
  generatedAt: string
  renderer: DeckReviewFrameRenderer
  samples: DeckKeyframeSample[]
  source: 'deck-frame-manifest.json' | 'timed-deck.json'
  version: 1
  viewport: {height: number; width: number}
}

export interface DeckKeyframeTarget {
  frame: number
  label: string
  path: string
  slideId: string
  time: number
}

export interface DeckKeyframeSample extends DeckKeyframeTarget {
  capturedAt: string
  error?: string
  ok: boolean
  sha256?: string
  size?: number
}

export async function removeDeckReviewArtifacts(workspace: ProjectWorkspace): Promise<void> {
  await Promise.all([
    rm(resolve(workspace.rendersDir, 'review'), {force: true, recursive: true}),
    rm(workspace.store.resolve('review-report.json'), {force: true}),
  ])
}

export async function writeDeckReviewArtifacts(input: {
  deckQualityReport: DeckQualityReport
  keyframeQuality: {
    artifact: DeckKeyframeArtifact
    visualQuality: VisualSmokeQualityResult
  }
  keyframeQualityPath: string
  outputPath: string
  outputQuality: RenderedMediaQualityResult
  projectId: string
  subtitleQuality: SubtitleQualityResult
  timedDeck: TimedDeck
  videoRenderer: DeckReviewVideoRenderer
  workspace: ProjectWorkspace
}): Promise<DeckReviewArtifacts> {
  const reviewDir = resolve(input.workspace.rendersDir, 'review')
  const htmlPath = resolve(reviewDir, 'index.html')

  await removeDeckReviewArtifacts(input.workspace)
  await mkdir(reviewDir, {recursive: true})

  const report = createDeckReviewReport({
    ...input,
    htmlPath,
  })

  await bunWrite(htmlPath, renderDeckReviewHtml(report))

  const reportPath = await input.workspace.store.writeJson('review-report.json', report)

  return {
    htmlPath,
    report,
    reportPath,
  }
}

export function toVisualFrameSample(sample: DeckKeyframeSample): VisualFrameSample {
  return {
    capturedAt: sample.capturedAt,
    ...(sample.error === undefined ? {} : {error: sample.error}),
    ok: sample.ok,
    path: sample.path,
    ...(sample.sha256 === undefined ? {} : {sha256: sample.sha256}),
    ...(sample.size === undefined ? {} : {size: sample.size}),
    timestamp: sample.time,
  }
}

function createDeckReviewReport(input: {
  deckQualityReport: DeckQualityReport
  htmlPath: string
  keyframeQuality: {
    artifact: DeckKeyframeArtifact
    visualQuality: VisualSmokeQualityResult
  }
  keyframeQualityPath: string
  outputPath: string
  outputQuality: RenderedMediaQualityResult
  projectId: string
  subtitleQuality: SubtitleQualityResult
  timedDeck: TimedDeck
  videoRenderer: DeckReviewVideoRenderer
  workspace: ProjectWorkspace
}): DeckReviewReportArtifact {
  const keyframeBySlide = new Map(input.keyframeQuality.artifact.samples.map((sample) => [sample.slideId, sample]))
  const timingBySlide = new Map(input.timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const duration = input.timedDeck.timings.at(-1)?.end ?? input.keyframeQuality.artifact.duration

  return {
    duration,
    format: input.timedDeck.deck.format,
    generatedAt: new Date().toISOString(),
    keyframeQualityPath: toProjectPath(input.workspace.projectDir, input.keyframeQualityPath),
    outputPath: toProjectPath(input.workspace.projectDir, input.outputPath),
    projectId: input.projectId,
    renderer: input.keyframeQuality.artifact.renderer,
    reviewHtmlPath: toProjectPath(input.workspace.projectDir, input.htmlPath),
    slides: input.timedDeck.deck.slides.map((slide, index) => createDeckReviewSlideReport(slide, index, timingBySlide.get(slide.slideId), keyframeBySlide.get(slide.slideId))),
    source: 'timed-deck.json',
    summary: {
      deckErrors: input.deckQualityReport.summary.errors,
      deckWarnings: input.deckQualityReport.summary.warnings,
      keyframes: input.keyframeQuality.artifact.samples.length,
      outputErrors: input.outputQuality.errors,
      outputWarnings: input.outputQuality.warnings,
      slides: input.timedDeck.deck.slides.length,
      subtitleErrors: input.subtitleQuality.errors,
      subtitleWarnings: input.subtitleQuality.warnings,
      visualErrors: input.keyframeQuality.visualQuality.errors,
      visualWarnings: input.keyframeQuality.visualQuality.warnings,
    },
    title: input.timedDeck.deck.title,
    version: 1,
    videoRenderer: input.videoRenderer,
  }
}

function createDeckReviewSlideReport(slide: Slide, index: number, timing: SlideTiming | undefined, keyframe: DeckKeyframeSample | undefined): DeckReviewSlideReport {
  const start = roundSeconds(timing?.start ?? 0)
  const end = roundSeconds(timing?.end ?? start)

  return {
    duration: roundSeconds(Math.max(0, end - start)),
    end,
    index: index + 1,
    ...(keyframe === undefined
      ? {}
      : {
          keyframe: {
            ...(keyframe.error === undefined ? {} : {error: keyframe.error}),
            ok: keyframe.ok,
            path: keyframe.path,
            ...(keyframe.sha256 === undefined ? {} : {sha256: keyframe.sha256}),
            ...(keyframe.size === undefined ? {} : {size: keyframe.size}),
            time: keyframe.time,
          },
        }),
    ...(slide.points.length === 0 ? {} : {points: slide.points}),
    slideId: slide.slideId,
    ...(slide.speakerNote === undefined ? {} : {speakerNote: slide.speakerNote}),
    start,
    title: slide.title,
    type: slide.type,
  }
}

function renderDeckReviewHtml(report: DeckReviewReportArtifact): string {
  const issueTotal = report.summary.deckErrors
    + report.summary.deckWarnings
    + report.summary.outputErrors
    + report.summary.outputWarnings
    + report.summary.subtitleErrors
    + report.summary.subtitleWarnings
    + report.summary.visualErrors
    + report.summary.visualWarnings
  const summaryItems = [
    ['Slides', report.summary.slides],
    ['Keyframes', report.summary.keyframes],
    ['Deck issues', report.summary.deckErrors + report.summary.deckWarnings],
    ['Output issues', report.summary.outputErrors + report.summary.outputWarnings],
    ['Subtitle issues', report.summary.subtitleErrors + report.summary.subtitleWarnings],
    ['Visual issues', report.summary.visualErrors + report.summary.visualWarnings],
  ]
  const slideRows = report.slides.map((slide) => renderDeckReviewSlideHtml(slide)).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.title)} Deck Review</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; background: #f5f7fa; }
    body { margin: 0; padding: 28px; }
    main { max-width: 1180px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.15; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 16px; letter-spacing: 0; }
    p { margin: 0; color: #52606d; }
    a { color: #0b5fff; text-decoration: none; }
    .status { border-radius: 6px; padding: 8px 12px; font-weight: 700; background: ${issueTotal === 0 ? '#dff6e7' : '#fff3cd'}; color: ${issueTotal === 0 ? '#17663a' : '#7a4b00'}; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 22px; }
    .metric { background: #ffffff; border: 1px solid #d9e2ec; border-radius: 6px; padding: 12px; }
    .metric strong { display: block; font-size: 24px; line-height: 1.1; margin-bottom: 4px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; }
    .slide { background: #ffffff; border: 1px solid #d9e2ec; border-radius: 6px; overflow: hidden; }
    .slide img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #d9e2ec; }
    .slide-body { padding: 12px; }
    .slide-title { font-weight: 700; margin-bottom: 6px; }
    .meta { color: #6b7785; font-size: 12px; margin-bottom: 8px; }
    .points { margin: 8px 0 0; padding-left: 18px; color: #344054; font-size: 13px; }
    .note { margin-top: 8px; color: #475467; font-size: 13px; }
    .placeholder { display: grid; place-items: center; aspect-ratio: 16 / 9; background: #e9eef5; color: #6b7785; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>${escapeHtml(report.title)}</h1>
        <p>${escapeHtml(report.projectId)} &middot; ${escapeHtml(report.format)} &middot; ${escapeHtml(report.videoRenderer)} &middot; ${roundSeconds(report.duration)}s</p>
        <p><a href="${escapeHtml(reviewHtmlAssetPath(report.outputPath))}">final.mp4</a> &middot; <a href="${escapeHtml(reviewHtmlAssetPath(report.keyframeQualityPath))}">deck-keyframes.json</a></p>
      </div>
      <div class="status">${issueTotal === 0 ? 'OK' : `${issueTotal} issues`}</div>
    </header>
    <section class="summary">
      ${summaryItems.map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${escapeHtml(String(label))}</span></div>`).join('\n      ')}
    </section>
    <section>
      <h2>Slides</h2>
      <div class="grid">
${slideRows}
      </div>
    </section>
  </main>
</body>
</html>
`
}

function renderDeckReviewSlideHtml(slide: DeckReviewSlideReport): string {
  const image = slide.keyframe === undefined
    ? '<div class="placeholder">No keyframe</div>'
    : `<img src="${escapeHtml(reviewHtmlAssetPath(slide.keyframe.path))}" alt="${escapeHtml(slide.title)}">`
  const points = slide.points === undefined
    ? ''
    : `<ul class="points">${slide.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`
  const note = slide.speakerNote === undefined ? '' : `<div class="note">${escapeHtml(slide.speakerNote)}</div>`
  const frameState = slide.keyframe === undefined ? 'missing' : (slide.keyframe.ok ? 'ok' : 'error')

  return `        <article class="slide">
          ${image}
          <div class="slide-body">
            <div class="slide-title">${slide.index}. ${escapeHtml(slide.title)}</div>
            <div class="meta">${escapeHtml(slide.type)} &middot; ${slide.start}s-${slide.end}s &middot; keyframe ${frameState}</div>
            ${points}
            ${note}
          </div>
        </article>`
}

function reviewHtmlAssetPath(projectPath: string): string {
  return projectPath.startsWith('renders/') ? `../${projectPath.slice('renders/'.length)}` : `../../${projectPath}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function toProjectPath(projectDir: string, path: string): string {
  return path.startsWith(`${projectDir}/`) ? path.slice(projectDir.length + 1) : path
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

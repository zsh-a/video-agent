import type {DeckFormat, DeckQualityIssue, DeckQualityReport, DeckSlideQualityMetrics, LongVideoSelectedMoments, MediaInfo, Narration, Slide, SlideTiming, Storyboard, TimedDeck, Timeline} from '@video-agent/ir'
import type {QualityIssue} from '@video-agent/quality'

import {checkNarrationTiming, checkStoryboardConsistency, checkTimelineBounds} from '@video-agent/quality'
import {compileDeckMotionPlan, resolveMotionStepsForTemplate, validateSlideAgainstTemplateManifest} from '@video-agent/renderer-deck'

import {deckSlideText} from '../planning/slide-content.js'
import {roundSeconds} from '../shared/utils.js'

export function createTextQualityIssues(input: {
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
  ]
}

export function createDeckQualityReport(timedDeck: TimedDeck): DeckQualityReport {
  const timingBySlide = new Map(timedDeck.timings.map((timing) => [timing.slideId, timing]))
  const issues: DeckQualityIssue[] = []
  const motion = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)
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

  const textCharacters = metrics.map((metric) => metric.textCharacters)

  return {
    checkedAt: new Date().toISOString(),
    format: timedDeck.deck.format,
    issues,
    metrics,
    motion: {
      trackCount: motion.summary.trackCount,
      tracksPerSlide: motion.summary.slides.map((slide) => ({
        presets: slide.presets,
        slideId: slide.slideId,
        trackCount: slide.trackCount,
        ...(slide.transitionIn === undefined ? {} : {transitionIn: slide.transitionIn}),
        ...(slide.transitionOut === undefined ? {} : {transitionOut: slide.transitionOut}),
      })),
      transitionCount: motion.summary.transitionCount,
    },
    renderEstimate: {
      estimatedFrames: Math.ceil(motion.duration * motion.timeline.fps),
      estimatedRenderSeconds: roundSeconds(motion.duration * estimateDeckRenderSecondsPerSecond(timedDeck.deck.format)),
      fps: motion.timeline.fps,
    },
    source: 'timed-deck.json',
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      slides: timedDeck.deck.slides.length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
    templateDistribution: createTemplateDistribution(timedDeck.deck.slides),
    textDensity: {
      averageCharacters: textCharacters.length === 0 ? 0 : roundSeconds(textCharacters.reduce((sum, value) => sum + value, 0) / textCharacters.length),
      dense: metrics.filter((metric) => metric.density === 'dense').length,
      maxCharacters: Math.max(0, ...textCharacters),
      normal: metrics.filter((metric) => metric.density === 'normal').length,
      quiet: metrics.filter((metric) => metric.density === 'quiet').length,
    },
    version: 1,
  }
}

export function summarizeQualityIssues(issues: QualityIssue[]): {errors: number; warnings: number} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

export function assertDeckQualityReportHasNoErrors(report: DeckQualityReport, reportPath?: string): void {
  if (report.summary.errors === 0) {
    return
  }

  const firstError = report.issues.find((issue) => issue.severity === 'error')
  const reportHint = reportPath === undefined ? '' : ` Report: ${reportPath}.`
  const firstErrorHint = firstError === undefined ? '' : ` First error: ${firstError.code}: ${firstError.message}`

  throw new Error(`Deck quality report contains ${report.summary.errors} error(s); refusing to render/export invalid Deck output.${reportHint}${firstErrorHint}`)
}

function createDeckSlideQualityMetrics(slide: Slide, duration: number): DeckSlideQualityMetrics {
  const textCharacters = deckSlideText(slide).length

  return {
    density: deckTextDensity(textCharacters),
    duration,
    estimatedCharactersPerSecond: duration <= 0 ? 0 : roundSeconds(textCharacters / duration),
    pointCount: slide.type === 'process' ? (slide.process?.steps.length ?? 0) : slide.points.length,
    slideId: slide.slideId,
    template: slide.type,
    textCharacters,
    titleCharacters: slide.title.length,
  }
}

function createDeckSlideQualityIssues(slide: Slide, metric: DeckSlideQualityMetrics, format: DeckFormat): DeckQualityIssue[] {
  const issues: DeckQualityIssue[] = [...createDeckTemplateQualityIssues(slide)]
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

  if (slide.type !== 'process' && metric.pointCount > 4) {
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

  if (slide.type === 'chart' && slide.chart !== undefined && slide.evidence.length === 0) {
    issues.push({
      code: 'deck.chart_missing_source',
      message: `Slide ${slide.slideId} is a chart slide without evidence for its chart data.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  issues.push(...createRequiredTemplateContentIssues(slide))

  if (slide.type === 'stat' && slide.stat !== undefined && slide.points.length === 0 && slide.stat.caption === undefined) {
    issues.push({
      code: 'deck.stat_missing_context',
      message: `Slide ${slide.slideId} is a stat slide without supporting points or caption.`,
      severity: 'warning',
      slideId: slide.slideId,
    })
  }

  return issues
}

function createRequiredTemplateContentIssues(slide: Slide): DeckQualityIssue[] {
  const issues: DeckQualityIssue[] = []

  if (slide.type === 'chart' && slide.chart === undefined) {
    issues.push(createSlideContentIssue(slide, 'deck.chart_missing_data', 'is a chart slide without chart data.'))
  }

  if (slide.type === 'one-big-idea' && slide.points.length === 0) {
    issues.push(createSlideContentIssue(slide, 'deck.idea_missing_statement', 'is a one-big-idea slide without an LLM-authored visible idea point.'))
  }

  if (slide.type === 'comparison' && (
    slide.comparison === undefined ||
    slide.comparison.left.points.length === 0 ||
    slide.comparison.right.points.length === 0
  )) {
    issues.push(createSlideContentIssue(slide, 'deck.comparison_incomplete', 'is a comparison slide without complete left and right comparison points.'))
  }

  if (slide.type === 'quote' && slide.quote === undefined) {
    issues.push(createSlideContentIssue(slide, 'deck.quote_missing_text', 'is a quote slide without quote text.'))
  }

  if (slide.type === 'code' && slide.code === undefined) {
    issues.push(createSlideContentIssue(slide, 'deck.code_missing_block', 'is a code slide without a code block.'))
  }

  if (slide.type === 'process' && slide.process === undefined) {
    issues.push(createSlideContentIssue(slide, 'deck.process_missing_steps', 'is a process slide without structured process steps.'))
  }

  if (slide.type === 'cta' && slide.points.length === 0) {
    issues.push(createSlideContentIssue(slide, 'deck.cta_missing_action', 'is a CTA slide without an LLM-authored action point.'))
  }

  if (slide.type === 'stat' && slide.stat === undefined) {
    issues.push(createSlideContentIssue(slide, 'deck.stat_missing_data', 'is a stat slide without stat data.'))
  }

  return issues
}

function createSlideContentIssue(slide: Slide, code: string, message: string): DeckQualityIssue {
  return {
    code,
    message: `Slide ${slide.slideId} ${message}`,
    severity: 'error',
    slideId: slide.slideId,
  }
}

function createDeckTemplateQualityIssues(slide: Slide): DeckQualityIssue[] {
  return validateSlideAgainstTemplateManifest(slide).map((message): DeckQualityIssue => ({
    code: 'deck.template.manifest_violation',
    message,
    severity: 'error',
    slideId: slide.slideId,
  }))
}

function deckTextDensity(textCharacters: number): DeckSlideQualityMetrics['density'] {
  if (textCharacters >= 180) {
    return 'dense'
  }

  if (textCharacters <= 72) {
    return 'quiet'
  }

  return 'normal'
}

function createTemplateDistribution(slides: Slide[]): Record<string, number> {
  const distribution: Record<string, number> = {}

  for (const slide of slides) {
    distribution[slide.type] = (distribution[slide.type] ?? 0) + 1
  }

  return distribution
}

function estimateDeckRenderSecondsPerSecond(format: DeckFormat): number {
  if (format === 'portrait_1080x1920') {
    return 0.65
  }

  if (format === 'square_1080x1080') {
    return 0.5
  }

  return 0.55
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

import type {Deck, DeckBrief, DeckContentAnalysis, DeckCoverageReport, DeckSlideOutline} from '@video-agent/ir'

import {DeckCoverageReportSchema} from '@video-agent/ir'

export function createDeckCoverageReport(input: {
  analysis: DeckContentAnalysis
  brief: DeckBrief
  deck?: Deck
  slideOutline: DeckSlideOutline
}): DeckCoverageReport {
  const covered = new Set(input.slideOutline.slides.flatMap((slide) => slide.sourceSectionIds))
  const requiredSectionIds = new Set([
    ...input.brief.requiredSectionIds,
    ...input.analysis.sections.filter((section) => section.mustCover).map((section) => section.id),
  ])
  const requiredUncovered = [...requiredSectionIds].filter((sectionId) => !covered.has(sectionId))
  const slideIds = input.deck?.slides.map((slide) => slide.slideId) ?? []
  const slideCoverage = input.slideOutline.slides.map((slide, index) => ({
    outlineId: slide.outlineId,
    ...(slideIds[index] === undefined ? {} : {slideId: slideIds[index]}),
    sourceSectionIds: slide.sourceSectionIds,
  }))
  const warnings = input.slideOutline.slides.filter((slide) => slide.sourceSectionIds.length > 3).length

  return DeckCoverageReportSchema.parse({
    checkedAt: new Date().toISOString(),
    coveredRequiredSections: requiredSectionIds.size - requiredUncovered.length,
    requiredSections: requiredSectionIds.size,
    requiredUncovered,
    slideCoverage,
    source: 'slide-outline.json',
    summary: {
      errors: requiredUncovered.length,
      warnings,
    },
    version: 1,
  })
}

export function assertDeckCoverage(report: DeckCoverageReport): void {
  if (report.summary.errors === 0) {
    return
  }

  throw new Error(`Deck slide outline does not cover ${report.summary.errors} required source section(s): ${report.requiredUncovered.join(', ')}. Rewrite the slide outline before generating slides.`)
}

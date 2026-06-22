import type {RenderSummary} from './status-types.js'

import {RenderOutputSchema} from '../artifacts/core-schemas.js'
import {readOptionalProjectJson} from './optional-json.js'

export async function readRenderSummary(path: string): Promise<RenderSummary> {
  const value = await readOptionalProjectJson(path)

  if (value === undefined) {
    return createEmptyRenderSummary()
  }

  const report = RenderOutputSchema.safeParse(value)

  return report.success ? createRenderSummary(report.data) : createEmptyRenderSummary()
}

function createRenderSummary(report: RenderOutputArtifact): RenderSummary {
  return {
    ...readAudioRenderSummary(report),
    ...readOutputRenderSummary(report),
    rendered: true,
    ...readRendererSummary(report),
    ...readReviewRenderSummary(report),
    ...readSubtitleRenderSummary(report),
    ...readTemplateRenderSummary(report),
    ...readVisualRenderSummary(report),
  }
}

function readAudioRenderSummary(report: RenderOutputArtifact): Pick<RenderSummary, 'audioInputs' | 'audioQualityErrors' | 'audioQualityWarnings' | 'audioWarnings' | 'missingVoiceovers'> {
  return {
    audioInputs: report.audioInputs ?? 0,
    audioQualityErrors: report.audioQuality?.errors ?? 0,
    audioQualityWarnings: report.audioQuality?.warnings ?? 0,
    audioWarnings: report.audioDiagnostics?.warnings.length ?? 0,
    missingVoiceovers: report.audioDiagnostics?.missingVoiceovers.length ?? 0,
  }
}

function readOutputRenderSummary(report: RenderOutputArtifact): Pick<RenderSummary, 'output' | 'outputErrors' | 'outputWarnings'> {
  return {
    ...(report.outputPath === undefined ? {} : {output: report.outputPath}),
    outputErrors: report.outputQuality?.errors ?? 0,
    outputWarnings: report.outputQuality?.warnings ?? 0,
  }
}

function readRendererSummary(report: RenderOutputArtifact): Pick<RenderSummary, 'renderer'> {
  return {renderer: report.renderer}
}

function readReviewRenderSummary(report: RenderOutputArtifact): Pick<RenderSummary, 'reviewAvailable' | 'reviewHtml' | 'reviewReport'> {
  return {
    reviewAvailable: report.reviewHtmlPath !== undefined && report.reviewReportPath !== undefined,
    ...(report.reviewHtmlPath === undefined ? {} : {reviewHtml: report.reviewHtmlPath}),
    ...(report.reviewReportPath === undefined ? {} : {reviewReport: report.reviewReportPath}),
  }
}

function readSubtitleRenderSummary(report: RenderOutputArtifact): Pick<RenderSummary, 'subtitleErrors' | 'subtitleWarnings'> {
  return {
    subtitleErrors: report.subtitleQuality?.errors ?? 0,
    subtitleWarnings: report.subtitleQuality?.warnings ?? 0,
  }
}

function readVisualRenderSummary(report: RenderOutputArtifact): Pick<RenderSummary, 'visualErrors' | 'visualWarnings'> {
  return {
    visualErrors: report.visualQuality?.errors ?? 0,
    visualWarnings: report.visualQuality?.warnings ?? 0,
  }
}

function readTemplateRenderSummary(report: RenderOutputArtifact): Pick<RenderSummary, 'templateErrors' | 'templateWarnings'> {
  return {
    templateErrors: report.templateQuality?.errors ?? 0,
    templateWarnings: report.templateQuality?.warnings ?? 0,
  }
}

function createEmptyRenderSummary(): RenderSummary {
  return {
    audioInputs: 0,
    audioQualityErrors: 0,
    audioQualityWarnings: 0,
    audioWarnings: 0,
    missingVoiceovers: 0,
    outputErrors: 0,
    outputWarnings: 0,
    rendered: false,
    reviewAvailable: false,
    subtitleErrors: 0,
    subtitleWarnings: 0,
    templateErrors: 0,
    templateWarnings: 0,
    visualErrors: 0,
    visualWarnings: 0,
  }
}

type RenderOutputArtifact = ReturnType<typeof RenderOutputSchema.parse>

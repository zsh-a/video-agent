import type {RenderSummary} from './status-types.js'

import {readOptionalJson} from '../shared/file-io.js'
import {readArrayLength, readFiniteNumber, readIssueErrors, readIssueWarnings, type IssueCountLike} from './status-utils.js'

export async function readRenderSummary(path: string): Promise<RenderSummary> {
  const report = await readOptionalJson<RenderOutputLike>(path)

  return report === undefined ? createEmptyRenderSummary() : createRenderSummary(report)
}

function createRenderSummary(report: RenderOutputLike): RenderSummary {
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

function readAudioRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'audioInputs' | 'audioQualityErrors' | 'audioQualityWarnings' | 'audioWarnings' | 'missingVoiceovers'> {
  return {
    audioInputs: readFiniteNumber(report.audioInputs) ?? 0,
    audioQualityErrors: readIssueErrors(report.audioQuality),
    audioQualityWarnings: readIssueWarnings(report.audioQuality),
    audioWarnings: readArrayLength(report.audioDiagnostics, 'warnings'),
    missingVoiceovers: readArrayLength(report.audioDiagnostics, 'missingVoiceovers'),
  }
}

function readOutputRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'output' | 'outputErrors' | 'outputWarnings'> {
  return {
    ...(typeof report.outputPath === 'string' ? {output: report.outputPath} : {}),
    outputErrors: readIssueErrors(report.outputQuality),
    outputWarnings: readIssueWarnings(report.outputQuality),
  }
}

function readRendererSummary(report: RenderOutputLike): Pick<RenderSummary, 'renderer'> {
  return typeof report.renderer === 'string' ? {renderer: report.renderer} : {}
}

function readReviewRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'reviewAvailable' | 'reviewHtml' | 'reviewReport'> {
  return {
    reviewAvailable: typeof report.reviewHtmlPath === 'string' && typeof report.reviewReportPath === 'string',
    ...(typeof report.reviewHtmlPath === 'string' ? {reviewHtml: report.reviewHtmlPath} : {}),
    ...(typeof report.reviewReportPath === 'string' ? {reviewReport: report.reviewReportPath} : {}),
  }
}

function readSubtitleRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'subtitleErrors' | 'subtitleWarnings'> {
  return {
    subtitleErrors: readIssueErrors(report.subtitleQuality),
    subtitleWarnings: readIssueWarnings(report.subtitleQuality),
  }
}

function readVisualRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'visualErrors' | 'visualWarnings'> {
  return {
    visualErrors: readIssueErrors(report.visualQuality),
    visualWarnings: readIssueWarnings(report.visualQuality),
  }
}

function readTemplateRenderSummary(report: RenderOutputLike): Pick<RenderSummary, 'templateErrors' | 'templateWarnings'> {
  return {
    templateErrors: readIssueErrors(report.templateQuality),
    templateWarnings: readIssueWarnings(report.templateQuality),
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

interface RenderOutputLike {
  audioDiagnostics?: unknown
  audioInputs?: unknown
  audioQuality?: IssueCountLike
  outputPath?: unknown
  outputQuality?: IssueCountLike
  renderer?: unknown
  reviewHtmlPath?: unknown
  reviewReportPath?: unknown
  subtitleQuality?: IssueCountLike
  templateQuality?: IssueCountLike
  visualQuality?: IssueCountLike
}

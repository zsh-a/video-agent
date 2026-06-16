import {resolve} from 'node:path'

import type {ArtifactIntegrityResult} from './artifacts.js'
import type {ProjectStatus, QualitySummary, RenderSummary} from './project-status.js'

import {LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, StoryboardSchema} from '@video-agent/ir'
import {checkExplainerStructure, type QualityIssue} from '@video-agent/quality'

import {verifyProjectArtifacts} from './artifacts.js'
import {readOptionalJson as readOptionalJsonFile} from './file-io.js'
import {readProjectStatus} from './project-status.js'

export interface ProjectQualityReport {
  artifacts: ArtifactIntegrityResult
  content: QualitySummary
  generatedAt: string
  ok: boolean
  pipeline: QualitySummary
  projectId: string
  render: RenderSummary
  summary: ProjectQualitySummary
}

export interface ProjectQualitySummary {
  errors: number
  warnings: number
}

export async function readProjectQuality(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectQualityReport> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const [status, artifacts, contentIssues] = await Promise.all([
    readProjectStatus(projectId, workspaceDir),
    verifyProjectArtifacts(projectId, workspaceDir),
    readProjectContentIssues(artifactsDir),
  ])
  const content = summarizeQualityIssues(contentIssues)
  const summary = summarizeProjectQuality(status, artifacts, content)

  return {
    artifacts,
    content,
    generatedAt: new Date().toISOString(),
    ok: summary.errors === 0 && summary.warnings === 0,
    pipeline: status.summary.quality,
    projectId,
    render: status.summary.render,
    summary,
  }
}

export async function readProjectQualityDetails(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectQualityReport & {contentIssues: QualityIssue[]; qualityReport?: unknown; renderOutput?: unknown}> {
  const report = await readProjectQuality(projectId, workspaceDir)
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')

  return {
    ...report,
    contentIssues: await readProjectContentIssues(artifactsDir),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, 'quality-report.json'), 'qualityReport')),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, 'render-output.json'), 'renderOutput')),
  }
}

function summarizeProjectQuality(status: ProjectStatus, artifacts: ArtifactIntegrityResult, content: QualitySummary): ProjectQualitySummary {
  const errors =
    status.summary.quality.errors +
    status.summary.render.outputErrors +
    status.summary.render.subtitleErrors +
    status.summary.render.audioQualityErrors +
    status.summary.render.templateErrors +
    status.summary.render.visualErrors +
    artifacts.summary.errors +
    content.errors
  const warnings =
    status.summary.quality.warnings +
    status.summary.render.outputWarnings +
    status.summary.render.subtitleWarnings +
    status.summary.render.audioQualityWarnings +
    status.summary.render.templateWarnings +
    status.summary.render.visualWarnings +
    status.summary.render.audioWarnings +
    status.summary.render.missingVoiceovers +
    artifacts.summary.warnings +
    content.warnings

  return {
    errors,
    warnings,
  }
}

async function readProjectContentIssues(artifactsDir: string): Promise<QualityIssue[]> {
  const [mediaInfo, narration, selectedMoments, storyboard] = await Promise.all([
    readOptionalParsedJson(resolve(artifactsDir, 'media-info.json'), MediaInfoSchema),
    readOptionalParsedJson(resolve(artifactsDir, 'narration.json'), NarrationSchema),
    readOptionalParsedJson(resolve(artifactsDir, 'selected-moments.json'), LongVideoSelectedMomentsSchema),
    readOptionalParsedJson(resolve(artifactsDir, 'storyboard.json'), StoryboardSchema),
  ])

  if (mediaInfo === undefined || narration === undefined || selectedMoments === undefined || storyboard === undefined) {
    return []
  }

  return checkExplainerStructure({
    mediaInfo,
    narration,
    selectedMoments,
    storyboard,
  })
}

async function readOptionalParsedJson<T>(path: string, schema: {parse(value: unknown): T}): Promise<T | undefined> {
  const value = await readOptionalJsonFile(path)

  if (value === undefined) {
    return undefined
  }

  try {
    return schema.parse(value)
  } catch {
    return undefined
  }
}

function summarizeQualityIssues(issues: QualityIssue[]): QualitySummary {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    issues: issues.length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

async function readOptionalJsonProperty<T extends string>(path: string, key: T): Promise<Record<string, never> | Record<T, unknown>> {
  const value = await readOptionalJsonFile(path)

  return value === undefined ? {} : {[key]: value} as Record<T, unknown>
}

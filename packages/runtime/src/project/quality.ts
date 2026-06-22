import {resolve} from 'node:path'

import type {ArtifactIntegrityResult} from '../artifacts/index.js'
import type {ProjectStatus, QualitySummary, RenderSummary} from './status.js'

import {DeckQualityReportSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, StoryboardSchema} from '@video-agent/ir'
import {checkExplainerStructure, summarizeQualityIssues, type QualityIssue} from '@video-agent/quality'

import {DECK_QUALITY_REPORT_ARTIFACT_NAME, MEDIA_INFO_ARTIFACT_NAME, NARRATION_ARTIFACT_NAME, QUALITY_REPORT_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME, SELECTED_MOMENTS_ARTIFACT_NAME, STORYBOARD_ARTIFACT_NAME} from '../artifacts/artifact-names.js'
import {verifyProjectArtifacts} from '../artifacts/index.js'
import {readOptionalProjectJson} from './optional-json.js'
import {readProjectStatus} from './status.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
export interface ProjectQualityReport {
  artifacts: ArtifactIntegrityResult
  content: QualitySummary
  deck: QualitySummary
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

export async function readProjectQuality(projectId: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ProjectQualityReport> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const [status, artifacts, contentIssues] = await Promise.all([
    readProjectStatus(projectId, workspaceDir),
    verifyProjectArtifacts(projectId, workspaceDir),
    readProjectContentIssues(artifactsDir),
  ])
  const deckIssues = await readProjectDeckQualityIssues(artifactsDir)
  const content = summarizeQualityIssues(contentIssues)
  const deck = summarizeQualityIssues(deckIssues)
  const summary = summarizeProjectQuality(status, artifacts, content, deck)

  return {
    artifacts,
    content,
    deck,
    generatedAt: new Date().toISOString(),
    ok: summary.errors === 0 && summary.warnings === 0,
    pipeline: status.summary.quality,
    projectId,
    render: status.summary.render,
    summary,
  }
}

export async function readProjectQualityDetails(projectId: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ProjectQualityReport & {contentIssues: QualityIssue[]; deckIssues: QualityIssue[]; deckQualityReport?: unknown; qualityReport?: unknown; renderOutput?: unknown}> {
  const report = await readProjectQuality(projectId, workspaceDir)
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')

  return {
    ...report,
    contentIssues: await readProjectContentIssues(artifactsDir),
    deckIssues: await readProjectDeckQualityIssues(artifactsDir),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, DECK_QUALITY_REPORT_ARTIFACT_NAME), 'deckQualityReport')),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, QUALITY_REPORT_ARTIFACT_NAME), 'qualityReport')),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, RENDER_OUTPUT_ARTIFACT_NAME), 'renderOutput')),
  }
}

function summarizeProjectQuality(status: ProjectStatus, artifacts: ArtifactIntegrityResult, content: QualitySummary, deck: QualitySummary): ProjectQualitySummary {
  const errors =
    status.summary.quality.errors +
    status.summary.render.outputErrors +
    status.summary.render.subtitleErrors +
    status.summary.render.audioQualityErrors +
    status.summary.render.templateErrors +
    status.summary.render.visualErrors +
    artifacts.summary.errors +
    content.errors +
    deck.errors
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
    content.warnings +
    deck.warnings

  return {
    errors,
    warnings,
  }
}

async function readProjectDeckQualityIssues(artifactsDir: string): Promise<QualityIssue[]> {
  const report = await readOptionalParsedJson(resolve(artifactsDir, DECK_QUALITY_REPORT_ARTIFACT_NAME), DeckQualityReportSchema)

  return report?.issues ?? []
}

async function readProjectContentIssues(artifactsDir: string): Promise<QualityIssue[]> {
  const [mediaInfo, narration, selectedMoments, storyboard] = await Promise.all([
    readOptionalParsedJson(resolve(artifactsDir, MEDIA_INFO_ARTIFACT_NAME), MediaInfoSchema),
    readOptionalParsedJson(resolve(artifactsDir, NARRATION_ARTIFACT_NAME), NarrationSchema),
    readOptionalParsedJson(resolve(artifactsDir, SELECTED_MOMENTS_ARTIFACT_NAME), LongVideoSelectedMomentsSchema),
    readOptionalParsedJson(resolve(artifactsDir, STORYBOARD_ARTIFACT_NAME), StoryboardSchema),
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
  const value = await readOptionalProjectJson(path)

  if (value === undefined) {
    return undefined
  }

  try {
    return schema.parse(value)
  } catch {
    return undefined
  }
}

async function readOptionalJsonProperty<T extends string>(path: string, key: T): Promise<Record<string, never> | Record<T, unknown>> {
  const value = await readOptionalProjectJson(path)

  return value === undefined ? {} : {[key]: value} as Record<T, unknown>
}

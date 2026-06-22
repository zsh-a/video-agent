import {resolve} from 'node:path'

import type {ArtifactIntegrityResult} from '../artifacts/index.js'
import type {QualitySummary, RenderSummary} from './status.js'

import {DeckQualityReportSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, StoryboardSchema} from '@video-agent/ir'
import {checkExplainerStructure, summarizeQualityIssues, type QualityIssue} from '@video-agent/quality'

import {DECK_QUALITY_REPORT_ARTIFACT_NAME, MEDIA_INFO_ARTIFACT_NAME, NARRATION_ARTIFACT_NAME, QUALITY_REPORT_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME, SELECTED_MOMENTS_ARTIFACT_NAME, STORYBOARD_ARTIFACT_NAME} from '../artifacts/artifact-names.js'
import {verifyProjectArtifacts} from '../artifacts/index.js'
import {readQualitySummary} from './quality-summary.js'
import {readRenderSummary} from './render-summary.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
import {readOptionalJson} from '../shared/file-io.js'
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
  const artifacts = await verifyProjectArtifacts(projectId, workspaceDir)
  const [pipeline, render] = await Promise.all([
    readDiagnosticQualitySummary(artifactsDir, artifacts),
    readDiagnosticRenderSummary(artifactsDir, artifacts),
  ])
  const [contentIssues, deckIssues] = await Promise.all([
    readProjectContentIssues(artifactsDir, artifacts),
    readProjectDeckQualityIssues(artifactsDir, artifacts),
  ])
  const content = summarizeQualityIssues(contentIssues)
  const deck = summarizeQualityIssues(deckIssues)
  const summary = summarizeProjectQuality(pipeline, render, artifacts, content, deck)

  return {
    artifacts,
    content,
    deck,
    generatedAt: new Date().toISOString(),
    ok: summary.errors === 0 && summary.warnings === 0,
    pipeline,
    projectId,
    render,
    summary,
  }
}

export async function readProjectQualityDetails(projectId: string, workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<ProjectQualityReport & {contentIssues: QualityIssue[]; deckIssues: QualityIssue[]; deckQualityReport?: unknown; qualityReport?: unknown; renderOutput?: unknown}> {
  const report = await readProjectQuality(projectId, workspaceDir)
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')

  return {
    ...report,
    contentIssues: await readProjectContentIssues(artifactsDir, report.artifacts),
    deckIssues: await readProjectDeckQualityIssues(artifactsDir, report.artifacts),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, DECK_QUALITY_REPORT_ARTIFACT_NAME), 'deckQualityReport')),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, QUALITY_REPORT_ARTIFACT_NAME), 'qualityReport')),
    ...(await readOptionalJsonProperty(resolve(artifactsDir, RENDER_OUTPUT_ARTIFACT_NAME), 'renderOutput')),
  }
}

function summarizeProjectQuality(pipeline: QualitySummary, render: RenderSummary, artifacts: ArtifactIntegrityResult, content: QualitySummary, deck: QualitySummary): ProjectQualitySummary {
  const errors =
    pipeline.errors +
    render.outputErrors +
    render.subtitleErrors +
    render.audioQualityErrors +
    render.templateErrors +
    render.visualErrors +
    artifacts.summary.errors +
    content.errors +
    deck.errors
  const warnings =
    pipeline.warnings +
    render.outputWarnings +
    render.subtitleWarnings +
    render.audioQualityWarnings +
    render.templateWarnings +
    render.visualWarnings +
    render.audioWarnings +
    render.missingVoiceovers +
    artifacts.summary.warnings +
    content.warnings +
    deck.warnings

  return {
    errors,
    warnings,
  }
}

async function readDiagnosticQualitySummary(artifactsDir: string, artifacts: ArtifactIntegrityResult): Promise<QualitySummary> {
  if (hasSchemaInvalidArtifact(artifacts, QUALITY_REPORT_ARTIFACT_NAME)) {
    return createEmptyQualitySummary()
  }

  return readQualitySummary(resolve(artifactsDir, QUALITY_REPORT_ARTIFACT_NAME))
}

async function readDiagnosticRenderSummary(artifactsDir: string, artifacts: ArtifactIntegrityResult): Promise<RenderSummary> {
  if (hasSchemaInvalidArtifact(artifacts, RENDER_OUTPUT_ARTIFACT_NAME)) {
    return createEmptyRenderSummary()
  }

  return readRenderSummary(resolve(artifactsDir, RENDER_OUTPUT_ARTIFACT_NAME))
}

function hasSchemaInvalidArtifact(artifacts: ArtifactIntegrityResult, artifactName: string): boolean {
  return artifacts.schemaInvalid.some((issue) => issue.name === artifactName)
}

function createEmptyQualitySummary(): QualitySummary {
  return {
    errors: 0,
    issues: 0,
    warnings: 0,
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

async function readProjectDeckQualityIssues(artifactsDir: string, artifacts: ArtifactIntegrityResult): Promise<QualityIssue[]> {
  if (hasSchemaInvalidArtifact(artifacts, DECK_QUALITY_REPORT_ARTIFACT_NAME)) {
    return []
  }

  const report = await readOptionalParsedJson(resolve(artifactsDir, DECK_QUALITY_REPORT_ARTIFACT_NAME), DeckQualityReportSchema)

  return report?.issues ?? []
}

async function readProjectContentIssues(artifactsDir: string, artifacts: ArtifactIntegrityResult): Promise<QualityIssue[]> {
  if ([MEDIA_INFO_ARTIFACT_NAME, NARRATION_ARTIFACT_NAME, SELECTED_MOMENTS_ARTIFACT_NAME, STORYBOARD_ARTIFACT_NAME].some((name) => hasSchemaInvalidArtifact(artifacts, name))) {
    return []
  }

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
  const value = await readOptionalJson(path)

  if (value === undefined) {
    return undefined
  }

  return schema.parse(value)
}

async function readOptionalJsonProperty<T extends string>(path: string, key: T): Promise<Record<string, never> | Record<T, unknown>> {
  const value = await readOptionalJson(path)

  return value === undefined ? {} : {[key]: value} as Record<T, unknown>
}

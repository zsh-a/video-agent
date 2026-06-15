import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import type {ArtifactIntegrityResult} from './artifacts.js'
import type {ProjectStatus, QualitySummary, RenderSummary} from './project-status.js'

import {verifyProjectArtifacts} from './artifacts.js'
import {readProjectStatus} from './project-status.js'

export interface ProjectQualityReport {
  artifacts: ArtifactIntegrityResult
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
  const [status, artifacts] = await Promise.all([readProjectStatus(projectId, workspaceDir), verifyProjectArtifacts(projectId, workspaceDir)])
  const summary = summarizeProjectQuality(status, artifacts)

  return {
    artifacts,
    generatedAt: new Date().toISOString(),
    ok: summary.errors === 0 && summary.warnings === 0,
    pipeline: status.summary.quality,
    projectId,
    render: status.summary.render,
    summary,
  }
}

export async function readProjectQualityDetails(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectQualityReport & {qualityReport?: unknown; renderOutput?: unknown}> {
  const report = await readProjectQuality(projectId, workspaceDir)
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')

  return {
    ...report,
    ...(await readOptionalJson(resolve(artifactsDir, 'quality-report.json'), 'qualityReport')),
    ...(await readOptionalJson(resolve(artifactsDir, 'render-output.json'), 'renderOutput')),
  }
}

function summarizeProjectQuality(status: ProjectStatus, artifacts: ArtifactIntegrityResult): ProjectQualitySummary {
  const errors =
    status.summary.quality.errors +
    status.summary.render.outputErrors +
    status.summary.render.subtitleErrors +
    status.summary.render.audioQualityErrors +
    status.summary.render.templateErrors +
    status.summary.render.visualErrors +
    artifacts.summary.errors
  const warnings =
    status.summary.quality.warnings +
    status.summary.render.outputWarnings +
    status.summary.render.subtitleWarnings +
    status.summary.render.audioQualityWarnings +
    status.summary.render.templateWarnings +
    status.summary.render.visualWarnings +
    status.summary.render.audioWarnings +
    status.summary.render.missingVoiceovers +
    artifacts.summary.warnings

  return {
    errors,
    warnings,
  }
}

async function readOptionalJson<T extends string>(path: string, key: T): Promise<Record<string, never> | Record<T, unknown>> {
  try {
    return {
      [key]: JSON.parse(await readFile(path, 'utf8')) as unknown,
    } as Record<T, unknown>
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

import {copyFile, mkdir, readdir, stat} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'

import type {ProjectQualityReport} from './project-quality.js'

import {readProjectQuality} from './project-quality.js'
import {createProjectWorkspace} from './workspace.js'

export type ExportFormat = 'bundle' | 'hyperframes' | 'video'

export interface ExportProjectOptions {
  format?: ExportFormat
  outputPath?: string
  projectId: string
  requireQuality?: boolean
  workspaceDir?: string
}

export interface ExportProjectResult {
  artifactPath: string
  format: ExportFormat
  outputPath: string
  projectDir: string
  projectId: string
  quality?: ProjectQualityReport
  requireQuality: boolean
  sourcePath: string
}

export class ExportQualityError extends Error {
  constructor(
    readonly projectId: string,
    readonly quality: ProjectQualityReport,
  ) {
    super(`Project ${projectId} did not pass quality checks: ${quality.summary.errors} error(s), ${quality.summary.warnings} warning(s).`)
    this.name = 'ExportQualityError'
  }
}

export async function exportProject(options: ExportProjectOptions): Promise<ExportProjectResult> {
  const format = options.format ?? 'video'
  const quality = options.requireQuality === true ? await readProjectQuality(options.projectId, options.workspaceDir) : undefined

  if (quality !== undefined && !quality.ok) {
    throw new ExportQualityError(options.projectId, quality)
  }

  const workspace = await createProjectWorkspace({
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const sourcePath = resolveExportSource(workspace.projectDir, format)
  const outputPath = resolve(options.outputPath ?? defaultOutputPath(options.projectId, format))

  await assertExists(sourcePath)
  await mkdir(dirname(outputPath), {recursive: true})

  await (format === 'video' ? copyFile(sourcePath, outputPath) : copyDirectory(sourcePath, outputPath))

  const artifactPath = await workspace.store.writeJson('export-output.json', {
    completedAt: new Date().toISOString(),
    format,
    outputPath,
    ...(quality === undefined ? {} : {quality}),
    requireQuality: options.requireQuality === true,
    sourcePath,
    version: 1,
  })

  return {
    artifactPath,
    format,
    outputPath,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    ...(quality === undefined ? {} : {quality}),
    requireQuality: options.requireQuality === true,
    sourcePath,
  }
}

function defaultOutputPath(projectId: string, format: ExportFormat): string {
  if (format === 'video') {
    return `${projectId}.mp4`
  }

  return `${projectId}-${format}`
}

function resolveExportSource(projectDir: string, format: ExportFormat): string {
  if (format === 'video') {
    return resolve(projectDir, 'renders', 'final.mp4')
  }

  if (format === 'hyperframes') {
    return resolve(projectDir, 'renders', 'hyperframes')
  }

  return projectDir
}

async function assertExists(path: string): Promise<void> {
  try {
    await stat(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Export source does not exist: ${path}. Render the project before exporting.`)
    }

    throw error
  }
}

async function copyDirectory(sourceDir: string, outputDir: string): Promise<void> {
  await mkdir(outputDir, {recursive: true})

  // Copy sequentially to keep error reporting deterministic for nested export bundles.
  /* eslint-disable no-await-in-loop */
  for (const entry of await readdir(sourceDir, {withFileTypes: true})) {
    const sourcePath = join(sourceDir, entry.name)
    const outputPath = join(outputDir, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, outputPath)
    } else if (entry.isFile()) {
      await copyFile(sourcePath, outputPath)
    }
  }
  /* eslint-enable no-await-in-loop */
}

import {copyFile, mkdir, readdir, rm, stat} from 'node:fs/promises'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'

import type {ProjectQualityReport} from '../project/quality.js'

import {EXPORT_OUTPUT_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME} from '../artifacts/artifact-names.js'
import {RenderOutputSchema} from '../artifacts/core-schemas.js'
import {JsonFileParseError, readOptionalJson} from '../shared/file-io.js'
import {readProjectQuality} from '../project/quality.js'
import {createProjectWorkspace} from '../shared/workspace.js'
import {isExportFormat, type ExportFormat} from './export-format.js'

export {EXPORT_FORMATS, isExportFormat, type ExportFormat} from './export-format.js'

export interface ExportProjectOptions {
  cleanOutput?: boolean
  format: ExportFormat
  outputPath?: string
  projectId: string
  requireQuality?: boolean
  workspaceDir?: string
}

export interface ExportProjectResult {
  artifactPath: string
  cleanOutput: boolean
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
  const quality = options.requireQuality === true ? await readProjectQuality(options.projectId, options.workspaceDir) : undefined

  if (quality !== undefined && !quality.ok) {
    throw new ExportQualityError(options.projectId, quality)
  }

  const workspace = await createProjectWorkspace({
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const format = requireExportFormat(options.format)
  const sourcePath = await resolveExportSource(workspace.projectDir, workspace.artifactsDir, format)
  const outputPath = resolve(options.outputPath ?? defaultOutputPath(options.projectId, format))
  const cleanOutput = options.cleanOutput === true

  await assertExists(sourcePath)
  assertExportTarget(sourcePath, outputPath, format)
  await mkdir(dirname(outputPath), {recursive: true})

  if (format === 'video') {
    await copyFile(sourcePath, outputPath)
  } else {
    if (cleanOutput) {
      await rm(outputPath, {force: true, recursive: true})
    }

    await copyDirectory(sourcePath, outputPath)
  }

  const artifactPath = await workspace.store.writeJson(EXPORT_OUTPUT_ARTIFACT_NAME, {
    cleanOutput,
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
    cleanOutput,
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

function requireExportFormat(format: ExportFormat | undefined): ExportFormat {
  if (format !== undefined && isExportFormat(format)) {
    return format
  }

  throw new Error('Export format is required; choose "video" or "bundle". No render-output format inference is allowed.')
}

async function resolveExportSource(projectDir: string, artifactsDir: string, format: ExportFormat): Promise<string> {
  if (format === 'bundle') {
    return projectDir
  }

  const value = await readExportRenderOutputJson(resolve(artifactsDir, RENDER_OUTPUT_ARTIFACT_NAME))

  if (value === undefined) {
    throw new Error('Video export requires render-output.json with a non-empty outputPath; no renders/final.mp4 path fallback is allowed.')
  }

  const renderOutput = RenderOutputSchema.safeParse(value)

  if (!renderOutput.success) {
    throw new Error('Video export requires schema-valid render-output.json; no render-output shape inference is allowed.')
  }

  if (renderOutput.data.outputPath === undefined || renderOutput.data.outputPath.trim() === '') {
    throw new Error('Video export requires render-output.json with a non-empty outputPath; no renders/final.mp4 path fallback is allowed.')
  }

  return resolveProjectPath(projectDir, renderOutput.data.outputPath)
}

async function readExportRenderOutputJson(path: string): Promise<unknown | undefined> {
  try {
    return await readOptionalJson(path)
  } catch (error) {
    if (error instanceof JsonFileParseError) {
      throw new Error('Video export requires valid JSON in render-output.json; no render-output shape inference is allowed.')
    }

    throw error
  }
}

function resolveProjectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path)
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

function assertExportTarget(sourcePath: string, outputPath: string, format: ExportFormat): void {
  if (sourcePath === outputPath) {
    throw new Error(`Export output path must differ from source path: ${outputPath}`)
  }

  if (format === 'video') {
    return
  }

  if (isInside(outputPath, sourcePath)) {
    throw new Error(`Export output directory cannot be inside export source: ${outputPath}`)
  }

  if (isInside(sourcePath, outputPath)) {
    throw new Error(`Export output directory cannot contain export source: ${outputPath}`)
  }
}

function isInside(childPath: string, parentPath: string): boolean {
  const path = relative(parentPath, childPath)

  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
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

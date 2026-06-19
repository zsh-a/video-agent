import {mkdir, readdir, rm, stat} from 'node:fs/promises'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'

import type {ProjectQualityReport} from './project-quality.js'

import {bunCopyFile} from './bun-runtime.js'
import {readOptionalJson} from './file-io.js'
import {readProjectQuality} from './project-quality.js'
import {createProjectWorkspace} from './workspace.js'

export type ExportFormat = 'bundle' | 'video'

export interface ExportProjectOptions {
  cleanOutput?: boolean
  format?: ExportFormat
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

interface RenderOutputExportReference {
  outputPath?: string
  renderer?: string
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
  const renderOutput = await readOptionalJson<RenderOutputExportReference>(resolve(workspace.artifactsDir, 'render-output.json'))
  const format = options.format ?? inferExportFormat(renderOutput)
  const sourcePath = resolveExportSource(workspace.projectDir, format, renderOutput)
  const outputPath = resolve(options.outputPath ?? defaultOutputPath(options.projectId, format))
  const cleanOutput = options.cleanOutput === true

  await assertExists(sourcePath)
  assertExportTarget(sourcePath, outputPath, format)
  await mkdir(dirname(outputPath), {recursive: true})

  if (format === 'video') {
    await bunCopyFile(sourcePath, outputPath)
  } else {
    if (cleanOutput) {
      await rm(outputPath, {force: true, recursive: true})
    }

    await copyDirectory(sourcePath, outputPath)
  }

  const artifactPath = await workspace.store.writeJson('export-output.json', {
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

function inferExportFormat(renderOutput: RenderOutputExportReference | undefined): ExportFormat {
  return renderOutput?.renderer === undefined ? 'bundle' : 'video'
}

function resolveExportSource(projectDir: string, format: ExportFormat, renderOutput: RenderOutputExportReference | undefined): string {
  if (format === 'video') {
    return resolveProjectPath(projectDir, renderOutput?.outputPath ?? 'renders/final.mp4')
  }

  return projectDir
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
      await bunCopyFile(sourcePath, outputPath)
    }
  }
  /* eslint-enable no-await-in-loop */
}

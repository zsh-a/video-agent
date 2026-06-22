import type {z} from 'zod'

import {readFile, stat} from 'node:fs/promises'
import {isAbsolute, relative, resolve} from 'node:path'

import {RENDER_OUTPUT_ARTIFACT_NAME} from '../artifacts/artifact-names.js'
import {RenderOutputSchema} from '../artifacts/core-schemas.js'
import {readOptionalProjectJson} from './optional-json.js'

import {DEFAULT_WORKSPACE_DIR} from '../shared/defaults.js'
type RenderOutputArtifact = z.infer<typeof RenderOutputSchema>
type VisualFrameSampleArtifact = NonNullable<NonNullable<RenderOutputArtifact['visualQuality']>['frameSamples']>[number]

export interface ProjectVisualSamplesOptions {
  includeContent?: boolean
  workspaceDir?: string
}

export interface ProjectVisualSamplesReport {
  projectDir: string
  projectId: string
  samples: ProjectVisualSample[]
}

export interface ProjectVisualSample {
  capturedAt?: string
  contentBase64?: string
  error?: string
  exists: boolean
  ok: boolean
  path?: string
  relativePath?: string
  reportSha256?: string
  reportSize?: number
  size?: number
  timestamp: number
}

export async function readProjectVisualSamples(projectId: string, options: ProjectVisualSamplesOptions = {}): Promise<ProjectVisualSamplesReport> {
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const renderOutput = await readRenderOutput(projectDir)
  const samples = await Promise.all(readFrameSamples(renderOutput).map((sample) => readFrameSample(projectDir, sample, options.includeContent === true)))

  return {
    projectDir,
    projectId,
    samples,
  }
}

async function readRenderOutput(projectDir: string): Promise<RenderOutputArtifact | undefined> {
  const value = await readOptionalProjectJson(resolve(projectDir, 'artifacts', RENDER_OUTPUT_ARTIFACT_NAME))

  return value === undefined ? undefined : RenderOutputSchema.parse(value)
}

function readFrameSamples(renderOutput: RenderOutputArtifact | undefined): VisualFrameSampleArtifact[] {
  return renderOutput?.visualQuality?.frameSamples ?? []
}

async function readFrameSample(projectDir: string, sample: VisualFrameSampleArtifact, includeContent: boolean): Promise<ProjectVisualSample> {
  const base = createBaseSample(sample)
  const path = isAbsolute(sample.path) ? resolve(sample.path) : resolve(projectDir, sample.path)

  if (!isInsideDirectory(projectDir, path)) {
    return {
      ...base,
      error: `Visual sample path is outside the project directory: ${sample.path}`,
      exists: false,
      path,
    }
  }

  try {
    const metadata = await stat(path)
    const content = includeContent ? await readFile(path) : undefined

    return {
      ...base,
      ...(content === undefined ? {} : {contentBase64: Buffer.from(content).toString('base64')}),
      exists: true,
      path,
      relativePath: relative(projectDir, path),
      size: metadata.size,
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {
        ...base,
        error: 'Visual sample file is missing.',
        exists: false,
        path,
        relativePath: relative(projectDir, path),
      }
    }

    throw error
  }
}

function createBaseSample(sample: VisualFrameSampleArtifact): Omit<ProjectVisualSample, 'exists'> {
  return {
    capturedAt: sample.capturedAt,
    ok: sample.ok,
    ...(sample.sha256 === undefined ? {} : {reportSha256: sample.sha256}),
    ...(sample.size === undefined ? {} : {reportSize: sample.size}),
    timestamp: sample.timestamp,
  }
}

function isInsideDirectory(directory: string, path: string): boolean {
  const relativePath = relative(directory, path)

  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.startsWith('/') && !relativePath.startsWith('\\')
}

import {readFile, stat} from 'node:fs/promises'
import {isAbsolute, relative, resolve} from 'node:path'

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
  reportSize?: number
  size?: number
  timestamp: number
}

export async function readProjectVisualSamples(projectId: string, options: ProjectVisualSamplesOptions = {}): Promise<ProjectVisualSamplesReport> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const renderOutput = await readRenderOutput(projectDir)
  const samples = await Promise.all(readFrameSamples(renderOutput).map((sample) => readFrameSample(projectDir, sample, options.includeContent === true)))

  return {
    projectDir,
    projectId,
    samples,
  }
}

async function readRenderOutput(projectDir: string): Promise<RenderOutputLike | undefined> {
  try {
    return JSON.parse(await readFile(resolve(projectDir, 'artifacts', 'render-output.json'), 'utf8')) as RenderOutputLike
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

function readFrameSamples(renderOutput: RenderOutputLike | undefined): VisualFrameSampleLike[] {
  if (renderOutput === undefined) {
    return []
  }

  if (Array.isArray(renderOutput.visualQuality?.frameSamples)) {
    return renderOutput.visualQuality.frameSamples.filter((sample): sample is VisualFrameSampleLike => isFrameSampleLike(sample))
  }

  return isFrameSampleLike(renderOutput.visualQuality?.frameSample) ? [renderOutput.visualQuality.frameSample] : []
}

async function readFrameSample(projectDir: string, sample: VisualFrameSampleLike, includeContent: boolean): Promise<ProjectVisualSample> {
  const base = createBaseSample(sample)

  if (sample.path === undefined) {
    return {
      ...base,
      error: 'Visual sample path is missing.',
      exists: false,
    }
  }

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
      ...(content === undefined ? {} : {contentBase64: content.toString('base64')}),
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

function createBaseSample(sample: VisualFrameSampleLike): Omit<ProjectVisualSample, 'exists'> {
  return {
    ...(sample.capturedAt === undefined ? {} : {capturedAt: sample.capturedAt}),
    ok: sample.ok,
    ...(sample.size === undefined ? {} : {reportSize: sample.size}),
    timestamp: sample.timestamp,
  }
}

function isInsideDirectory(directory: string, path: string): boolean {
  const relativePath = relative(directory, path)

  return relativePath !== '' && !relativePath.startsWith('..') && !relativePath.startsWith('/') && !relativePath.startsWith('\\')
}

function isFrameSampleLike(value: unknown): value is VisualFrameSampleLike {
  return (
    isRecord(value) &&
    typeof value.ok === 'boolean' &&
    typeof value.timestamp === 'number' &&
    Number.isFinite(value.timestamp) &&
    (value.capturedAt === undefined || typeof value.capturedAt === 'string') &&
    (value.path === undefined || typeof value.path === 'string') &&
    (value.size === undefined || (typeof value.size === 'number' && Number.isFinite(value.size)))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface RenderOutputLike {
  visualQuality?: {
    frameSample?: unknown
    frameSamples?: unknown[]
  }
}

interface VisualFrameSampleLike {
  capturedAt?: string
  ok: boolean
  path?: string
  size?: number
  timestamp: number
}

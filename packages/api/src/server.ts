/* eslint-disable n/no-unsupported-features/node-builtins */
import {
  checkRuntimeHealth,
  exportProject,
  ExportQualityError,
  inspectFfmpegAudio,
  listProjectArtifacts,
  listProjects,
  PipelineCheckpointError,
  readProjectArtifact,
  readProjectEvents,
  readProjectQuality,
  readProjectStatus,
  readProjectVisualSamples,
  recoverWorkspaceJobs,
  renderProject,
  rerunProject,
  runInitialPipeline,
  verifyProjectArtifacts,
} from '@video-agent/runtime'

export type {ProjectEventKind, ProviderCallRole, ProviderCallStatus} from '@video-agent/runtime'

export interface ApiHandlerOptions {
  workspaceDir?: string
}

export function createApiFetchHandler(options: ApiHandlerOptions = {}): (request: Request) => Promise<Response> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'

  return async (request) => {
    try {
      return await routeRequest(request, workspaceDir)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

async function routeRequest(request: Request, workspaceDir: string): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))

  if (segments.length === 0 || segments[0] === 'health') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return jsonResponse({ok: true, workspaceDir})
  }

  if (segments.length === 1 && segments[0] === 'doctor') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return jsonResponse(await checkRuntimeHealth({workspaceDir}))
  }

  if (segments.length === 1 && segments[0] === 'projects') {
    if (request.method === 'POST') {
      const body = await readJsonBody(request)

      return jsonResponse(
        await runInitialPipeline({
          fromStage: parseOptionalEnum(readStringField(body, 'fromStage'), ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality']),
          inputPath: readRequiredStringField(body, 'inputPath'),
          projectId: readStringField(body, 'projectId') ?? undefined,
          workspaceDir,
        }),
      )
    }

    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return jsonResponse({projects: await listProjects(workspaceDir)})
  }

  if (segments.length === 1 && segments[0] === 'worker') {
    if (request.method !== 'POST') {
      return methodNotAllowed()
    }

    const body = await readJsonBody(request)

    return jsonResponse(
      await recoverWorkspaceJobs({
        dryRun: readBooleanField(body, 'dryRun'),
        limit: readNumberField(body, 'limit'),
        maxAttempts: readNumberField(body, 'maxAttempts'),
        statuses: resolveRecoverableStatuses(readStringField(body, 'status')),
        workspaceDir,
      }),
    )
  }

  if (segments[0] === 'projects' && segments[1] !== undefined) {
    return routeProjectRequest(request, segments.slice(1), url, workspaceDir)
  }

  return jsonResponse({error: {message: 'Not found'}}, {status: 404})
}

// Route dispatch is intentionally centralized so the API handler remains dependency-light.
// eslint-disable-next-line complexity
async function routeProjectRequest(request: Request, segments: string[], url: URL, workspaceDir: string): Promise<Response> {
  const [projectId, resource, artifactName] = segments

  if (resource === 'rerun') {
    if (request.method !== 'POST') {
      return methodNotAllowed()
    }

    const body = await readJsonBody(request)

    return jsonResponse(
      await rerunProject(projectId, {
        fromStage: parseOptionalEnum(readStringField(body, 'fromStage'), ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality']),
        workspaceDir,
      }),
    )
  }

  if (resource === 'render') {
    if (request.method !== 'POST') {
      return methodNotAllowed()
    }

    const body = await readJsonBody(request)

    return jsonResponse(
      await renderProject(projectId, {
        audio: readBooleanField(body, 'audio'),
        audioDucking: readBooleanField(body, 'audioDucking'),
        duckingAttackMs: readNumberField(body, 'duckingAttackMs'),
        duckingRatio: readNumberField(body, 'duckingRatio'),
        duckingReleaseMs: readNumberField(body, 'duckingReleaseMs'),
        duckingThreshold: readNumberField(body, 'duckingThreshold'),
        hyperframesCommand: readStringArrayField(body, 'hyperframesCommand'),
        hyperframesOutput: readStringField(body, 'hyperframesOutput') ?? undefined,
        hyperframesRender: readBooleanField(body, 'hyperframesRender'),
        hyperframesValidate: readBooleanField(body, 'hyperframesValidate'),
        output: readStringField(body, 'output') ?? undefined,
        renderer: parseOptionalEnum(readStringField(body, 'renderer'), ['ffmpeg', 'hyperframes']),
        sourceVolume: readNumberField(body, 'sourceVolume'),
        subtitles: readBooleanField(body, 'subtitles'),
        voiceoverVolume: readNumberField(body, 'voiceoverVolume'),
        workspaceDir,
      }),
    )
  }

  if (resource === 'audio') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return jsonResponse(
      await inspectFfmpegAudio(projectId, {
        audio: parseOptionalBoolean(url.searchParams.get('audio')),
        audioDucking: parseOptionalBoolean(url.searchParams.get('audioDucking')),
        duckingAttackMs: parseOptionalNumber(url.searchParams.get('duckingAttackMs')),
        duckingRatio: parseOptionalNumber(url.searchParams.get('duckingRatio')),
        duckingReleaseMs: parseOptionalNumber(url.searchParams.get('duckingReleaseMs')),
        duckingThreshold: parseOptionalNumber(url.searchParams.get('duckingThreshold')),
        sourceVolume: parseOptionalNumber(url.searchParams.get('sourceVolume')),
        voiceoverVolume: parseOptionalNumber(url.searchParams.get('voiceoverVolume')),
        workspaceDir,
      }),
    )
  }

  if (resource === 'visual') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return jsonResponse(
      await readProjectVisualSamples(projectId, {
        includeContent: parseOptionalBoolean(url.searchParams.get('includeContent')),
        workspaceDir,
      }),
    )
  }

  if (resource === 'export') {
    if (request.method !== 'POST') {
      return methodNotAllowed()
    }

    const body = await readJsonBody(request)

    return jsonResponse(
      await exportProject({
        format: parseOptionalEnum(readStringField(body, 'format'), ['video', 'hyperframes', 'bundle']),
        outputPath: readStringField(body, 'outputPath') ?? undefined,
        projectId,
        requireQuality: readBooleanField(body, 'requireQuality'),
        workspaceDir,
      }),
    )
  }

  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  if (resource === undefined || resource === 'status') {
    return jsonResponse(await readProjectStatus(projectId, workspaceDir))
  }

  if (resource === 'events') {
    return jsonResponse(
      await readProjectEvents(projectId, {
        kind: parseOptionalEnum(url.searchParams.get('kind'), ['pipeline', 'provider']),
        limit: parseOptionalInteger(url.searchParams.get('limit')),
        providerRole: parseOptionalEnum(url.searchParams.get('role'), ['asr', 'tts', 'vlm']),
        providerStatus: parseOptionalEnum(url.searchParams.get('status'), ['failed', 'succeeded']),
        workspaceDir,
      }),
    )
  }

  if (resource === 'quality') {
    return jsonResponse(await readProjectQuality(projectId, workspaceDir))
  }

  if (resource === 'artifacts' && artifactName === undefined) {
    return jsonResponse({artifacts: await listProjectArtifacts(projectId, workspaceDir)})
  }

  if (resource === 'artifacts' && artifactName === 'verify') {
    return jsonResponse(await verifyProjectArtifacts(projectId, workspaceDir))
  }

  if (resource === 'artifacts' && artifactName !== undefined) {
    return jsonResponse(await readProjectArtifact(projectId, artifactName, workspaceDir))
  }

  return jsonResponse({error: {message: 'Not found'}}, {status: 404})
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-length') === '0') {
    return {}
  }

  const text = await request.text()

  if (text.trim() === '') {
    return {}
  }

  const parsed = JSON.parse(text) as unknown

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Request body must be a JSON object.')
  }

  return parsed as Record<string, unknown>
}

function readStringField(body: Record<string, unknown>, field: string): null | string {
  const value = body[field]

  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new TypeError(`Field ${field} must be a string.`)
  }

  return value
}

function readRequiredStringField(body: Record<string, unknown>, field: string): string {
  const value = readStringField(body, field)

  if (value === null || value.trim() === '') {
    throw new TypeError(`Field ${field} is required.`)
  }

  return value
}

function readBooleanField(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field]

  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new TypeError(`Field ${field} must be a boolean.`)
  }

  return value
}

function readStringArrayField(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field]

  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`Field ${field} must be a non-empty string array.`)
  }

  return value
}

function readNumberField(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field]

  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Field ${field} must be a finite number.`)
  }

  return value
}

function parseOptionalInteger(value: null | string): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer query parameter: ${value}`)
  }

  return parsed
}

function parseOptionalNumber(value: null | string): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid number query parameter: ${value}`)
  }

  return parsed
}

function parseOptionalBoolean(value: null | string): boolean | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(`Invalid boolean query parameter: ${value}`)
}

function parseOptionalEnum<T extends string>(value: null | string, values: readonly T[]): T | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  if (values.includes(value as T)) {
    return value as T
  }

  throw new Error(`Invalid query parameter: ${value}`)
}

function resolveRecoverableStatuses(status: null | string): Array<'failed' | 'running'> | undefined {
  if (status === null || status === 'active') {
    return undefined
  }

  if (status === 'failed' || status === 'running') {
    return [status]
  }

  throw new Error(`Invalid worker status: ${status}`)
}

interface JsonResponseInit {
  headers?: Record<string, string>
  status?: number
}

function jsonResponse(value: unknown, init?: JsonResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  })
}

function methodNotAllowed(): Response {
  return jsonResponse({error: {message: 'Method not allowed'}}, {status: 405})
}

function errorResponse(error: unknown): Response {
  if (error instanceof PipelineCheckpointError) {
    return jsonResponse(
      {
        error: {
          changedArtifacts: error.changedArtifacts,
          fromStage: error.fromStage,
          message: error.message,
          missingArtifacts: error.missingArtifacts,
          untrackedArtifacts: error.untrackedArtifacts,
        },
      },
      {status: 409},
    )
  }

  if (error instanceof ExportQualityError) {
    return jsonResponse(
      {
        error: {
          message: error.message,
          quality: error.quality,
        },
      },
      {status: 409},
    )
  }

  return jsonResponse(
    {
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    },
    {status: isNotFoundError(error) ? 404 : 500},
  )
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

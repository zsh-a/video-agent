import {PIPELINE_EVENT_TYPES} from '@video-agent/core'
import {DECK_HTML_CAPTURE_BACKENDS} from '@video-agent/ir'
import {DECK_FINAL_RENDERERS, createDeckFinalRenderProject, createDeckFrameShardBatchProject, createDeckFrameShardPlanProject, createDeckRemotionRenderProject, createDeckRendererBackendProject} from '@video-agent/pipeline-deck'
import {FILM_PIPELINE_STAGES, rerunFilmProject} from '@video-agent/pipeline-film'
import {DECK_RENDERER_BACKENDS, EXPORT_FORMATS, PROJECT_EVENT_KINDS, PROVIDER_CALL_ROLES, PROVIDER_CALL_STATUSES, exportProject, inspectFfmpegAudio, listProjectArtifacts, readProjectArtifact, readProjectEvents, readProjectProviderReport, readProjectQuality, readProjectQualityDetails, readProjectStatus, readProjectVisualSamples, readVideoAgentGuidedActions, renderProject, verifyProjectArtifacts} from '@video-agent/runtime'

import {parseOptionalBoolean, parseOptionalEnum, parseOptionalNonNegativeInteger, parseOptionalNumber, parseRequiredEnum, readBooleanField, readCommandPrefix, readJsonBody, readNonNegativeIntegerField, readNumberField, readPositiveIntegerField, readStringArrayField, readStringField} from './request.js'
import {jsonResponse, methodNotAllowed, projectFileResponse} from './response.js'

interface ProjectRouteContext {
  projectId: string
  request: Request
  url: URL
  workspaceDir: string
}

type ProjectRouteHandler = (context: ProjectRouteContext) => Promise<Response>

const PROJECT_ROUTES: Partial<Record<string, ProjectRouteHandler>> = {
  actions: routeProjectActions,
  artifacts: routeProjectArtifacts,
  'artifacts/verify': routeProjectArtifactVerification,
  audio: routeProjectAudio,
  'deck/backend': routeDeckBackend,
  'deck/backend-render': routeDeckBackendRender,
  'deck/render': routeDeckRender,
  'deck/shard-batch': routeDeckShardBatch,
  'deck/shards': routeDeckShards,
  events: routeProjectEvents,
  export: routeProjectExport,
  files: routeProjectFiles,
  '': routeProjectStatus,
  'provider-report': routeProjectProviderReport,
  quality: routeProjectQuality,
  render: routeProjectRender,
  rerun: routeProjectRerun,
  status: routeProjectStatus,
  watch: routeProjectWatch,
  visual: routeProjectVisual,
}

export async function routeProjectRequest(request: Request, segments: string[], url: URL, workspaceDir: string): Promise<Response> {
  const [projectId, resource, artifactName] = segments
  const route = PROJECT_ROUTES[projectRouteKey(resource, artifactName)]

  if (route !== undefined) {
    return route({projectId, request, url, workspaceDir})
  }

  if (resource === 'artifacts' && artifactName !== undefined) {
    return routeProjectArtifact({artifactName, projectId, request, url, workspaceDir})
  }

  return notFound()
}

async function routeProjectRerun({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await rerunFilmProject(projectId, {
      fromStage: parseOptionalEnum(readStringField(body, 'fromStage'), FILM_PIPELINE_STAGES),
      workspaceDir,
    }),
  )
}

async function routeProjectRender({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
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
      output: readStringField(body, 'output') ?? undefined,
      sourceVolume: readNumberField(body, 'sourceVolume'),
      subtitles: readBooleanField(body, 'subtitles'),
      voiceoverVolume: readNumberField(body, 'voiceoverVolume'),
      workspaceDir,
    }),
  )
}

async function routeDeckRender({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await createDeckFinalRenderProject({
      chromiumCommand: readStringArrayField(body, 'chromiumCommand'),
      finalize: readBooleanField(body, 'finalize'),
      finalizeOnly: readBooleanField(body, 'finalizeOnly'),
      frameCaptureBackend: parseOptionalEnum(readStringField(body, 'frameCaptureBackend'), DECK_HTML_CAPTURE_BACKENDS),
      frameConcurrency: readPositiveIntegerField(body, 'frameConcurrency'),
      frameEnd: readPositiveIntegerField(body, 'frameEnd'),
      frameStart: readPositiveIntegerField(body, 'frameStart'),
      htmlOutput: readStringField(body, 'htmlOutput') ?? undefined,
      htmlRender: readBooleanField(body, 'htmlRender'),
      htmlRenderCommand: readStringArrayField(body, 'htmlRenderCommand'),
      htmlValidate: readBooleanField(body, 'htmlValidate'),
      keyframeCaptureBackend: parseOptionalEnum(readStringField(body, 'keyframeCaptureBackend'), DECK_HTML_CAPTURE_BACKENDS),
      playwrightCommand: readStringArrayField(body, 'playwrightCommand'),
      projectId,
      renderer: parseOptionalEnum(readStringField(body, 'renderer'), DECK_FINAL_RENDERERS),
      workspaceDir,
    }),
  )
}

async function routeDeckShards({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await createDeckFrameShardPlanProject({
      frameCaptureBackend: parseOptionalEnum(readStringField(body, 'frameCaptureBackend'), DECK_HTML_CAPTURE_BACKENDS),
      frameShardSize: readPositiveIntegerField(body, 'frameShardSize'),
      projectId,
      workspaceDir,
    }),
  )
}

async function routeDeckShardBatch({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await createDeckFrameShardBatchProject({
      chromiumCommand: readStringArrayField(body, 'chromiumCommand'),
      frameCaptureBackend: parseOptionalEnum(readStringField(body, 'frameCaptureBackend'), DECK_HTML_CAPTURE_BACKENDS),
      frameConcurrency: readPositiveIntegerField(body, 'frameConcurrency'),
      frameShardSize: readPositiveIntegerField(body, 'frameShardSize'),
      playwrightCommand: readStringArrayField(body, 'playwrightCommand'),
      projectId,
      shardConcurrency: readPositiveIntegerField(body, 'shardConcurrency'),
      shardRetryDelayMs: readNonNegativeIntegerField(body, 'shardRetryDelayMs'),
      shardRetries: readNonNegativeIntegerField(body, 'shardRetries'),
      workspaceDir,
    }),
  )
}

async function routeDeckBackend({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await createDeckRendererBackendProject({
      backend: parseRequiredEnum(readStringField(body, 'backend'), 'backend', DECK_RENDERER_BACKENDS),
      compositionId: readStringField(body, 'compositionId') ?? undefined,
      fps: readPositiveIntegerField(body, 'fps'),
      outputDir: readStringField(body, 'outputDir') ?? undefined,
      projectId,
      workspaceDir,
    }),
  )
}

async function routeDeckBackendRender({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await createDeckRemotionRenderProject({
      command: readStringArrayField(body, 'command'),
      compositionId: readStringField(body, 'compositionId') ?? undefined,
      fps: readPositiveIntegerField(body, 'fps'),
      outputDir: readStringField(body, 'outputDir') ?? undefined,
      outputPath: readStringField(body, 'outputPath') ?? undefined,
      projectId,
      workspaceDir,
    }),
  )
}

async function routeProjectAudio({projectId, request, url, workspaceDir}: ProjectRouteContext): Promise<Response> {
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

async function routeProjectVisual({projectId, request, url, workspaceDir}: ProjectRouteContext): Promise<Response> {
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

async function routeProjectExport({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await exportProject({
      cleanOutput: readBooleanField(body, 'cleanOutput'),
      format: parseRequiredEnum(readStringField(body, 'format'), 'format', [...EXPORT_FORMATS]),
      outputPath: readStringField(body, 'outputPath') ?? undefined,
      projectId,
      requireQuality: readBooleanField(body, 'requireQuality'),
      workspaceDir,
    }),
  )
}

async function routeProjectStatus({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(await readProjectStatus(projectId, workspaceDir))
}

async function routeProjectWatch({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const encoder = new TextEncoder()
  let lastPayload = ''
  let interval: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    async cancel() {
      if (interval !== undefined) {
        clearInterval(interval)
      }
    },
    start(controller) {
      const send = async () => {
        try {
          const [status, events] = await Promise.all([
            readProjectStatus(projectId, workspaceDir),
            readProjectEvents(projectId, {limit: 16, workspaceDir}),
          ])
          const payload = JSON.stringify({events: events.events, projectStatus: status})

          if (payload === lastPayload) {
            return
          }

          lastPayload = payload
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${payload}\n\n`))
        } catch (error) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({message: error instanceof Error ? error.message : String(error)})}\n\n`))
        }
      }

      void send()
      interval = setInterval(() => void send(), 1000)
      request.signal.addEventListener('abort', () => {
        if (interval !== undefined) {
          clearInterval(interval)
        }
        controller.close()
      }, {once: true})
    },
  })

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
    },
  })
}

async function routeProjectEvents({projectId, request, url, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(
    await readProjectEvents(projectId, {
      kind: parseOptionalEnum(url.searchParams.get('kind'), [...PROJECT_EVENT_KINDS]),
      limit: parseOptionalNonNegativeInteger(url.searchParams.get('limit')),
      pipelineStage: url.searchParams.get('stage') ?? undefined,
      pipelineType: parseOptionalEnum(url.searchParams.get('type'), [...PIPELINE_EVENT_TYPES]),
      providerRole: parseOptionalEnum(url.searchParams.get('role'), [...PROVIDER_CALL_ROLES]),
      providerStatus: parseOptionalEnum(url.searchParams.get('status'), [...PROVIDER_CALL_STATUSES]),
      workspaceDir,
    }),
  )
}

async function routeProjectProviderReport({projectId, request, url, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(
    await readProjectProviderReport(projectId, {
      role: parseOptionalEnum(url.searchParams.get('role'), [...PROVIDER_CALL_ROLES]),
      status: parseOptionalEnum(url.searchParams.get('status'), [...PROVIDER_CALL_STATUSES]),
      workspaceDir,
    }),
  )
}

async function routeProjectQuality({projectId, request, url, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const includeDetails = parseOptionalBoolean(url.searchParams.get('details')) === true

  return jsonResponse(includeDetails ? await readProjectQualityDetails(projectId, workspaceDir) : await readProjectQuality(projectId, workspaceDir))
}

async function routeProjectActions({projectId, request, url, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(await readVideoAgentGuidedActions({
    artifactLimit: parseOptionalNonNegativeInteger(url.searchParams.get('artifactLimit')),
    commandPrefix: readCommandPrefix(url.searchParams),
    projectId,
    workspaceDir,
  }))
}

async function routeProjectFiles({projectId, request, url, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return projectFileResponse(projectId, url.searchParams.get('path'), workspaceDir, request)
}

async function routeProjectArtifacts({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse({artifacts: await listProjectArtifacts(projectId, workspaceDir)})
}

async function routeProjectArtifactVerification({projectId, request, workspaceDir}: ProjectRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(await verifyProjectArtifacts(projectId, workspaceDir))
}

async function routeProjectArtifact({
  artifactName,
  projectId,
  request,
  workspaceDir,
}: ProjectRouteContext & {artifactName: string}): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(await readProjectArtifact(projectId, artifactName, workspaceDir))
}

function projectRouteKey(resource: string | undefined, artifactName: string | undefined): string {
  if (resource === undefined) {
    return ''
  }

  return artifactName === undefined ? resource : `${resource}/${artifactName}`
}

function notFound(): Response {
  return jsonResponse({error: {message: 'Not found'}}, {status: 404})
}

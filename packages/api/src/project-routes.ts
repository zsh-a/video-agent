import {createDeckFinalRenderProject, createDeckFrameShardBatchProject, createDeckFrameShardPlanProject, createDeckRemotionRenderProject, createDeckRendererBackendProject} from '@video-agent/pipeline-deck'
import {FILM_PIPELINE_STAGES, rerunProject} from '@video-agent/pipeline-film'
import {exportProject, inspectFfmpegAudio, listProjectArtifacts, readProjectArtifact, readProjectEvents, readProjectProviderReport, readProjectQuality, readProjectQualityDetails, readProjectStatus, readProjectVisualSamples, readVideoAgentGuidedActions, renderProject, verifyProjectArtifacts} from '@video-agent/runtime'

import {parseOptionalBoolean, parseOptionalEnum, parseOptionalInteger, parseOptionalNumber, readBooleanField, readCommandPrefix, readJsonBody, readNumberField, readStringArrayField, readStringField} from './request.js'
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
    await rerunProject(projectId, {
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
      frameCaptureBackend: parseOptionalEnum(readStringField(body, 'frameCaptureBackend'), ['chromium', 'playwright']),
      frameConcurrency: readNumberField(body, 'frameConcurrency'),
      frameEnd: readNumberField(body, 'frameEnd'),
      frameStart: readNumberField(body, 'frameStart'),
      htmlOutput: readStringField(body, 'htmlOutput') ?? undefined,
      htmlRender: readBooleanField(body, 'htmlRender'),
      htmlRenderCommand: readStringArrayField(body, 'htmlRenderCommand'),
      htmlValidate: readBooleanField(body, 'htmlValidate'),
      keyframeCaptureBackend: parseOptionalEnum(readStringField(body, 'keyframeCaptureBackend'), ['chromium', 'playwright']),
      playwrightCommand: readStringArrayField(body, 'playwrightCommand'),
      projectId,
      renderer: parseOptionalEnum(readStringField(body, 'renderer'), ['remotion', 'html']),
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
      frameCaptureBackend: parseOptionalEnum(readStringField(body, 'frameCaptureBackend'), ['chromium', 'playwright']),
      frameShardSize: readNumberField(body, 'frameShardSize'),
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
      frameCaptureBackend: parseOptionalEnum(readStringField(body, 'frameCaptureBackend'), ['chromium', 'playwright']),
      frameConcurrency: readNumberField(body, 'frameConcurrency'),
      frameShardSize: readNumberField(body, 'frameShardSize'),
      playwrightCommand: readStringArrayField(body, 'playwrightCommand'),
      projectId,
      shardConcurrency: readNumberField(body, 'shardConcurrency'),
      shardRetryDelayMs: readNumberField(body, 'shardRetryDelayMs'),
      shardRetries: readNumberField(body, 'shardRetries'),
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
      backend: parseOptionalEnum(readStringField(body, 'backend'), ['motion-canvas', 'remotion']) ?? 'remotion',
      compositionId: readStringField(body, 'compositionId') ?? undefined,
      fps: readNumberField(body, 'fps'),
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
  parseOptionalEnum(readStringField(body, 'backend'), ['remotion'])

  return jsonResponse(
    await createDeckRemotionRenderProject({
      command: readStringArrayField(body, 'command'),
      compositionId: readStringField(body, 'compositionId') ?? undefined,
      fps: readNumberField(body, 'fps'),
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
      format: parseOptionalEnum(readStringField(body, 'format'), ['video', 'bundle']),
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
      kind: parseOptionalEnum(url.searchParams.get('kind'), ['pipeline', 'provider']),
      limit: parseOptionalInteger(url.searchParams.get('limit')),
      pipelineStage: url.searchParams.get('stage') ?? undefined,
      pipelineType: parseOptionalEnum(url.searchParams.get('type'), ['agent:run:complete', 'agent:run:fail', 'agent:run:start', 'agent:step:complete', 'agent:step:fail', 'agent:step:progress', 'agent:step:start', 'artifact', 'log', 'stage:complete', 'stage:fail', 'stage:progress', 'stage:retry', 'stage:start', 'tool:call:complete', 'tool:call:fail', 'tool:call:start']),
      providerRole: parseOptionalEnum(url.searchParams.get('role'), ['asr', 'script', 'tts', 'vlm']),
      providerStatus: parseOptionalEnum(url.searchParams.get('status'), ['failed', 'succeeded']),
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
      role: parseOptionalEnum(url.searchParams.get('role'), ['asr', 'script', 'tts', 'vlm']),
      status: parseOptionalEnum(url.searchParams.get('status'), ['failed', 'succeeded']),
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
    artifactLimit: parseOptionalInteger(url.searchParams.get('artifactLimit')),
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

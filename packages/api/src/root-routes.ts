import {FILM_RECOVERY_ORDER_BY_VALUES, FILM_RECOVERY_STATUS_OPTIONS, recoverFilmWorkspaceJobs, resolveFilmRecoverableStatuses} from '@video-agent/pipeline-film'
import {PROVIDER_SMOKE_TEST_ROLE_OPTIONS, checkRuntimeHealth, createProviderEnvironmentShellTemplate, listProjects, readConfig, readProviderEnvironment, readVideoAgentGuidedActions, resolveProviderSmokeTestRoles, runProviderSmokeTest} from '@video-agent/runtime'

import {parseOptionalBoolean, parseOptionalEnum, parseOptionalNonNegativeInteger, readBooleanField, readCommandPrefix, readEnvField, readEnvQuery, readJsonBody, readNonNegativeIntegerField, readStringField} from './request.js'
import {jsonResponse, methodNotAllowed} from './response.js'

interface RootRouteContext {
  request: Request
  url: URL
  workspaceDir: string
}

type RootRouteHandler = (context: RootRouteContext) => Promise<Response>

const ROOT_ROUTES: Record<string, RootRouteHandler> = {
  actions: routeActions,
  config: routeConfig,
  doctor: routeDoctor,
  health: routeHealth,
  projects: routeProjects,
  'provider-env': routeProviderEnvironment,
  'provider-test': routeProviderTest,
  worker: routeWorker,
}

export async function routeRootRequest(request: Request, segments: string[], url: URL, workspaceDir: string): Promise<Response> {
  if (segments.length > 1) {
    return notFound()
  }

  const routeName = segments[0] ?? 'health'
  const route = ROOT_ROUTES[routeName]

  return route === undefined ? notFound() : route({request, url, workspaceDir})
}

async function routeHealth({request, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse({ok: true, workspaceDir})
}

async function routeDoctor({request, url, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const report = await checkRuntimeHealth({env: readEnvQuery(url.searchParams), workspaceDir})

  return jsonResponse(report, {status: report.ok ? 200 : 503})
}

async function routeProviderEnvironment({request, url, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  const report = await readProviderEnvironment(workspaceDir, readEnvQuery(url.searchParams))
  const shellTemplate = parseOptionalBoolean(url.searchParams.get('shellTemplate')) === true
    ? createProviderEnvironmentShellTemplate(report, {includeOptional: parseOptionalBoolean(url.searchParams.get('includeOptional'))})
    : undefined

  return jsonResponse(shellTemplate === undefined ? report : {...report, shellTemplate})
}

async function routeProviderTest({request, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await runProviderSmokeTest({
      env: readEnvField(body, 'env'),
      framePath: readStringField(body, 'framePath') ?? undefined,
      mediaPath: readStringField(body, 'mediaPath') ?? undefined,
      roles: resolveProviderSmokeTestRoles(parseOptionalEnum(readStringField(body, 'role'), PROVIDER_SMOKE_TEST_ROLE_OPTIONS)),
      text: readStringField(body, 'text') ?? undefined,
      workspaceDir,
    }),
  )
}

async function routeConfig({request, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(await readConfig(workspaceDir))
}

async function routeActions({request, url, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse(await readVideoAgentGuidedActions({
    artifactLimit: parseOptionalNonNegativeInteger(url.searchParams.get('artifactLimit')),
    commandPrefix: readCommandPrefix(url.searchParams),
    workspaceDir,
  }))
}

async function routeProjects({request, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  return jsonResponse({projects: await listProjects(workspaceDir)})
}

async function routeWorker({request, workspaceDir}: RootRouteContext): Promise<Response> {
  if (request.method !== 'POST') {
    return methodNotAllowed()
  }

  const body = await readJsonBody(request)

  return jsonResponse(
    await recoverFilmWorkspaceJobs({
      dryRun: readBooleanField(body, 'dryRun'),
      limit: readNonNegativeIntegerField(body, 'limit'),
      maxAttempts: readNonNegativeIntegerField(body, 'maxAttempts'),
      orderBy: parseOptionalEnum(readStringField(body, 'orderBy'), FILM_RECOVERY_ORDER_BY_VALUES),
      runningStaleAfterMs: readNonNegativeIntegerField(body, 'runningStaleAfterMs'),
      statuses: resolveFilmRecoverableStatuses(parseOptionalEnum(readStringField(body, 'status'), FILM_RECOVERY_STATUS_OPTIONS)),
      workspaceDir,
    }),
  )
}

function notFound(): Response {
  return jsonResponse({error: {message: 'Not found'}}, {status: 404})
}

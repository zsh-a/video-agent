/* eslint-disable max-lines, n/no-unsupported-features/node-builtins */
import {
  checkRuntimeHealth,
  createProviderEnvironmentShellTemplate,
  exportProject,
  ExportQualityError,
  inspectFfmpegAudio,
  listProjectArtifacts,
  listProjects,
  PipelineCheckpointError,
  type ProviderSmokeTestRole,
  readConfig,
  readProjectArtifact,
  readProjectEvents,
  readProjectQuality,
  readProjectStatus,
  readProjectVisualSamples,
  readProviderEnvironment,
  readVideoAgentGuidedActions,
  recoverWorkspaceJobs,
  type RecoveryOrderBy,
  renderProject,
  rerunProject,
  runInitialPipeline,
  runProviderSmokeTest,
  verifyProjectArtifacts,
} from '@video-agent/runtime'
import {ZodError} from 'zod'

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

// Route dispatch is intentionally centralized so the API handler remains dependency-light.
// eslint-disable-next-line complexity
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

    const report = await checkRuntimeHealth({env: readEnvQuery(url.searchParams), workspaceDir})

    return jsonResponse(report, {status: report.ok ? 200 : 503})
  }

  if (segments.length === 1 && segments[0] === 'provider-env') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    const report = await readProviderEnvironment(workspaceDir, readEnvQuery(url.searchParams))
    const shellTemplate = parseOptionalBoolean(url.searchParams.get('shellTemplate')) === true
      ? createProviderEnvironmentShellTemplate(report, {includeOptional: parseOptionalBoolean(url.searchParams.get('includeOptional'))})
      : undefined

    return jsonResponse(shellTemplate === undefined ? report : {...report, shellTemplate})
  }

  if (segments.length === 1 && segments[0] === 'provider-test') {
    if (request.method !== 'POST') {
      return methodNotAllowed()
    }

    const body = await readJsonBody(request)

    return jsonResponse(
      await runProviderSmokeTest({
        env: readEnvField(body, 'env'),
        framePath: readStringField(body, 'framePath') ?? undefined,
        mediaPath: readStringField(body, 'mediaPath') ?? undefined,
        roles: resolveProviderSmokeTestRoles(readStringField(body, 'role')),
        text: readStringField(body, 'text') ?? undefined,
        workspaceDir,
      }),
    )
  }

  if (segments.length === 1 && segments[0] === 'config') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return jsonResponse(await readConfig(workspaceDir))
  }

  if (segments.length === 1 && segments[0] === 'actions') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return jsonResponse(await readVideoAgentGuidedActions({
      commandPrefix: readCommandPrefix(url.searchParams),
      workspaceDir,
    }))
  }

  if (segments.length === 1 && segments[0] === 'studio') {
    if (request.method !== 'GET') {
      return methodNotAllowed()
    }

    return htmlResponse(renderStudioHtml())
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
        orderBy: readRecoveryOrderBy(readStringField(body, 'orderBy')),
        runningStaleAfterMs: readNumberField(body, 'runningStaleAfterMs'),
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
        pipelineStage: url.searchParams.get('stage') ?? undefined,
        pipelineType: parseOptionalEnum(url.searchParams.get('type'), ['artifact', 'log', 'stage:complete', 'stage:fail', 'stage:retry', 'stage:start']),
        providerRole: parseOptionalEnum(url.searchParams.get('role'), ['asr', 'tts', 'vlm']),
        providerStatus: parseOptionalEnum(url.searchParams.get('status'), ['failed', 'succeeded']),
        workspaceDir,
      }),
    )
  }

  if (resource === 'quality') {
    return jsonResponse(await readProjectQuality(projectId, workspaceDir))
  }

  if (resource === 'actions') {
    return jsonResponse(await readVideoAgentGuidedActions({
      commandPrefix: readCommandPrefix(url.searchParams),
      projectId,
      workspaceDir,
    }))
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

function readEnvQuery(params: URLSearchParams): Record<string, string> | undefined {
  const values = params.getAll('env')

  if (values.length === 0) {
    return undefined
  }

  return parseEnvAssignments(values)
}

function readEnvField(body: Record<string, unknown>, field: string): Record<string, string> | undefined {
  if (body[field] === undefined || body[field] === null) {
    return undefined
  }

  if (typeof body[field] !== 'object' || Array.isArray(body[field])) {
    throw new TypeError(`Request field ${field} must be an object of string values.`)
  }

  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(body[field] as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new TypeError(`Request field ${field}.${key} must be a string.`)
    }

    env[key] = value
  }

  return env
}

function parseEnvAssignments(values: string[]): Record<string, string> {
  const env: Record<string, string> = {}

  for (const value of values) {
    const separatorIndex = value.indexOf('=')

    if (separatorIndex <= 0) {
      throw new Error(`Invalid env query value "${value}". Expected KEY=VALUE.`)
    }

    const key = value.slice(0, separatorIndex).trim()

    if (key.length === 0) {
      throw new Error(`Invalid env query value "${value}". Expected KEY=VALUE.`)
    }

    env[key] = value.slice(separatorIndex + 1)
  }

  return env
}

function readRequiredStringField(body: Record<string, unknown>, field: string): string {
  const value = readStringField(body, field)

  if (value === null || value.trim() === '') {
    throw new TypeError(`Field ${field} is required.`)
  }

  return value
}

function readCommandPrefix(params: URLSearchParams): string | undefined {
  const value = params.get('commandPrefix')

  if (value === null || value.trim() === '') {
    return undefined
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

function resolveProviderSmokeTestRoles(role: null | string): ProviderSmokeTestRole[] | undefined {
  if (role === null || role === 'all') {
    return undefined
  }

  if (role === 'asr' || role === 'tts' || role === 'vlm') {
    return [role]
  }

  throw new Error(`Invalid provider test role: ${role}`)
}

function readRecoveryOrderBy(value: null | string): RecoveryOrderBy | undefined {
  if (value === null) {
    return undefined
  }

  if (value === 'attempt' || value === 'oldest' || value === 'recent') {
    return value
  }

  throw new Error(`Invalid worker orderBy: ${value}`)
}

function renderStudioHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>video-agent studio</title>
  <style>
    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.4;
      color: #172026;
      background: #f6f7f9;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid #d9dee5;
      background: #ffffff;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      font-size: 18px;
      font-weight: 700;
    }

    h2 {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      color: #5c6875;
    }

    button {
      border: 1px solid #b9c2ce;
      border-radius: 6px;
      background: #ffffff;
      color: #172026;
      cursor: pointer;
      font: inherit;
      min-height: 32px;
      padding: 6px 10px;
    }

    select {
      border: 1px solid #b9c2ce;
      border-radius: 6px;
      background: #ffffff;
      color: #172026;
      font: inherit;
      min-height: 32px;
      padding: 6px 28px 6px 10px;
    }

    button[aria-pressed="true"] {
      border-color: #1769aa;
      background: #e8f2fb;
    }

    select:disabled,
    button:disabled {
      color: #8a96a3;
      cursor: not-allowed;
      background: #f1f3f5;
    }

    main {
      display: grid;
      grid-template-columns: minmax(220px, 320px) 1fr;
      min-height: calc(100vh - 69px);
    }

    aside {
      border-right: 1px solid #d9dee5;
      background: #ffffff;
      padding: 16px;
    }

    section {
      padding: 18px 20px;
    }

    .stack {
      display: grid;
      gap: 12px;
    }

    .project-list {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .project-list button {
      display: grid;
      gap: 3px;
      justify-items: start;
      width: 100%;
      text-align: left;
    }

    .muted {
      color: #657384;
      font-size: 12px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .panel {
      border: 1px solid #d9dee5;
      border-radius: 8px;
      background: #ffffff;
      padding: 14px;
    }

    .metric {
      font-size: 24px;
      font-weight: 700;
      margin-top: 8px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .action-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .control-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(140px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .control {
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: #42515f;
    }

    .control input,
    .control select {
      width: 100%;
    }

    .control input[type="checkbox"] {
      justify-self: start;
      min-height: 18px;
      width: 18px;
    }

    .status-line {
      min-height: 20px;
      margin-top: 10px;
      color: #42515f;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .summary-line {
      margin-top: 8px;
      color: #42515f;
      font-size: 13px;
    }

    .severity {
      border-radius: 999px;
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      min-width: 58px;
      padding: 2px 7px;
      text-align: center;
      text-transform: uppercase;
    }

    .severity--error {
      background: #fde8e8;
      color: #a61b1b;
    }

    .severity--warning {
      background: #fff4d6;
      color: #8a5a00;
    }

    .preview {
      max-height: 260px;
      overflow: auto;
      margin-top: 12px;
      border: 1px solid #d9dee5;
      border-radius: 6px;
      background: #f8fafc;
      padding: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }

    .sample-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .sample {
      border: 1px solid #d9dee5;
      border-radius: 6px;
      background: #f8fafc;
      padding: 8px;
    }

    .sample img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: contain;
      background: #111820;
      border-radius: 4px;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }

    th,
    td {
      border-bottom: 1px solid #e3e7ed;
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
    }

    th {
      color: #5c6875;
      font-weight: 700;
    }

    code {
      background: #eef1f5;
      border-radius: 4px;
      padding: 1px 4px;
    }

    @media (max-width: 760px) {
      main,
      .grid {
        grid-template-columns: 1fr;
      }

      aside {
        border-right: 0;
        border-bottom: 1px solid #d9dee5;
      }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>video-agent studio</h1>
      <p class="muted" id="workspace">Loading workspace</p>
    </div>
    <button id="refresh" type="button">Refresh</button>
  </header>
  <main>
    <aside>
      <h2>Projects</h2>
      <div class="project-list" id="projects"></div>
    </aside>
    <section class="stack">
      <div class="grid">
        <div class="panel">
          <h2>Status</h2>
          <p class="metric" id="status">none</p>
        </div>
        <div class="panel">
          <h2>Quality</h2>
          <p class="metric" id="quality">none</p>
        </div>
        <div class="panel">
          <h2>Render</h2>
          <p class="metric" id="render">none</p>
        </div>
      </div>
      <div class="grid">
        <div class="panel">
          <h2>Providers</h2>
          <p class="summary-line" id="provider-summary">Loading providers.</p>
          <table>
            <thead><tr><th>Role</th><th>Provider</th><th>Required Env</th></tr></thead>
            <tbody id="providers"></tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Runtime Config</h2>
          <p class="summary-line" id="config-summary">Loading config.</p>
          <table>
            <thead><tr><th>Key</th><th>Value</th></tr></thead>
            <tbody id="config"></tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Workspace</h2>
          <p class="summary-line" id="workspace-summary">Loading workspace.</p>
        </div>
      </div>
      <div class="panel">
        <h2>Actions</h2>
        <div class="actions">
          <button id="render-action" type="button">Render</button>
          <button id="export-action" type="button">Export</button>
          <span class="action-group">
            <select id="rerun-stage" aria-label="Rerun from stage"></select>
            <button id="rerun-action" type="button">Rerun</button>
          </span>
          <button id="worker-action" type="button">Worker dry-run</button>
          <button id="provider-test-action" type="button">Provider test</button>
        </div>
        <div class="control-grid">
          <label class="control">Renderer
            <select id="render-renderer">
              <option value="ffmpeg">ffmpeg</option>
              <option value="hyperframes">hyperframes</option>
            </select>
          </label>
          <label class="control">Subtitles
            <input id="render-subtitles" type="checkbox" checked>
          </label>
          <label class="control">Audio
            <input id="render-audio" type="checkbox" checked>
          </label>
          <label class="control">Ducking
            <input id="render-audio-ducking" type="checkbox">
          </label>
          <label class="control">Source volume
            <input id="render-source-volume" inputmode="decimal" placeholder="1">
          </label>
          <label class="control">Voiceover volume
            <input id="render-voiceover-volume" inputmode="decimal" placeholder="1">
          </label>
          <label class="control">HF validate
            <input id="render-hf-validate" type="checkbox">
          </label>
          <label class="control">HF render
            <input id="render-hf-render" type="checkbox">
          </label>
          <label class="control">HF command JSON
            <input id="render-hf-command" placeholder='["npx","hyperframes"]'>
          </label>
          <label class="control">HF output
            <input id="render-hf-output" placeholder="./hyperframes.mp4">
          </label>
        </div>
        <p class="status-line" id="action-status"></p>
      </div>
      <div class="panel">
        <h2>Guided Actions</h2>
        <table>
          <thead><tr><th>Action</th><th>Category</th><th>Description</th><th>Command</th><th></th></tr></thead>
          <tbody id="guided-actions"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Pipeline</h2>
        <table>
          <thead><tr><th>Stage</th><th>Status</th><th>Attempt</th></tr></thead>
          <tbody id="stages"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Artifacts</h2>
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Size</th><th></th></tr></thead>
          <tbody id="artifacts"></tbody>
        </table>
        <pre class="preview" id="artifact-preview">Select an artifact to preview.</pre>
      </div>
      <div class="panel">
        <h2>Visual Samples</h2>
        <div class="sample-grid" id="visual-samples"></div>
      </div>
      <div class="panel">
        <h2>Template Quality</h2>
        <p class="summary-line" id="template-summary">No template quality report.</p>
        <table>
          <thead><tr><th>Severity</th><th>Code</th><th>Message</th></tr></thead>
          <tbody id="template-issues"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Render Quality</h2>
        <p class="summary-line" id="render-quality-summary">No render quality report.</p>
        <table>
          <thead><tr><th>Area</th><th>Severity</th><th>Code</th><th>Message</th></tr></thead>
          <tbody id="render-quality-issues"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Artifact Integrity</h2>
        <p class="summary-line" id="artifact-integrity-summary">No artifact integrity report.</p>
        <table>
          <thead><tr><th>Status</th><th>Name</th><th>Detail</th></tr></thead>
          <tbody id="artifact-integrity-issues"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Recent Events</h2>
        <table>
          <thead><tr><th>Time</th><th>Kind</th><th>Detail</th></tr></thead>
          <tbody id="events"></tbody>
        </table>
      </div>
    </section>
  </main>
  <script type="module">
    const state = {projectId: undefined};
    const byId = (id) => document.getElementById(id);
    const listText = (items) => Array.isArray(items) && items.length > 0 ? items.join(", ") : "none";
    const formatApiError = (status, error, fallback) => {
      if (error?.code === "checkpoint_invalid") {
        return [
          "HTTP " + status + " checkpoint_invalid: " + (error.message ?? "Checkpoint artifacts are invalid."),
          "missing: " + listText(error.missingArtifacts),
          "changed: " + listText(error.changedArtifacts),
          "schema invalid: " + listText(error.schemaInvalidArtifacts),
          "untracked: " + listText(error.untrackedArtifacts),
        ].join(" | ");
      }
      if (error?.code === "export_quality_failed") {
        const quality = error.quality?.summary;
        const qualityText = quality === undefined ? "quality report unavailable" : quality.errors + " errors, " + quality.warnings + " warnings";
        return "HTTP " + status + " export_quality_failed: " + qualityText + " - " + (error.message ?? "Project quality gate failed.");
      }
      if (error?.code === "validation_error") {
        const issues = Array.isArray(error.issues) ? error.issues.map((issue) => (issue.path ?? []).join(".") + ": " + issue.message).join("; ") : "no issue details";
        return "HTTP " + status + " validation_error: " + issues;
      }
      return "HTTP " + status + ": " + (error?.message ?? fallback);
    };
    const createApiError = async (response) => {
      const bodyText = await response.text();
      let body;
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = undefined;
      }
      const error = body?.error;
      const result = new Error(formatApiError(response.status, error, bodyText));
      result.status = response.status;
      result.body = body;
      result.apiError = error;
      return result;
    };
    const api = async (path, options = {}) => {
      const response = await fetch(path, options);
      if (!response.ok) throw await createApiError(response);
      return response.json();
    };
    const text = (value) => value === undefined || value === null ? "" : String(value);
    const setRows = (id, rows, emptyCells) => {
      const target = byId(id);
      target.textContent = "";
      if (rows.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = emptyCells;
        cell.className = "muted";
        cell.textContent = "None";
        row.append(cell);
        target.append(row);
        return;
      }
      target.append(...rows);
    };
    const tableRow = (values) => {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = text(value);
        row.append(cell);
      }
      return row;
    };
    const renderProviderEnvironment = (report) => {
      const summary = report.summary ?? {
        configured: report.providers.reduce((count, provider) => count + provider.requirements.filter((requirement) => requirement.configured).length, 0),
        missingRequired: report.providers.flatMap((provider) => provider.requirements.filter((requirement) => requirement.required && !requirement.configured).map((requirement) => requirement.env)),
        total: report.providers.reduce((count, provider) => count + provider.requirements.length, 0),
      };
      byId("provider-summary").textContent = summary.configured + "/" + summary.total + " env configured, " + summary.missingRequired.length + " required missing";
      setRows("providers", report.providers.map((provider) => tableRow([
        provider.role,
        provider.provider,
        provider.requirements.filter((requirement) => requirement.required).map((requirement) => requirement.env + "=" + (requirement.configured ? "set" : "missing")).join(", ") || "none",
      ])), 3);
    };
    const renderConfig = (config) => {
      byId("config-summary").textContent = "job store " + config.persistence.jobStore + " | retries " + config.pipeline.maxStageRetries;
      setRows("config", [
        tableRow(["providers.asr", config.providers.asr]),
        tableRow(["providers.vlm", config.providers.vlm]),
        tableRow(["providers.tts", config.providers.tts]),
        tableRow(["persistence.jobStore", config.persistence.jobStore]),
        tableRow(["pipeline.maxStageRetries", config.pipeline.maxStageRetries]),
        tableRow(["pipeline.retryBackoffMs", config.pipeline.retryBackoffMs]),
      ], 2);
    };
    const optionalNumber = (id) => {
      const value = byId(id).value.trim();
      if (value === "") return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(id + " must be a number.");
      return parsed;
    };
    const optionalString = (id) => {
      const value = byId(id).value.trim();
      return value === "" ? undefined : value;
    };
    const optionalStringArray = (id) => {
      const value = optionalString(id);
      if (value === undefined) return undefined;
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
        throw new Error(id + " must be a JSON string array.");
      }
      return parsed;
    };
    const maybe = (object, key, value) => {
      if (value !== undefined) object[key] = value;
    };
    const readRenderOptions = () => {
      const options = {
        audio: byId("render-audio").checked,
        audioDucking: byId("render-audio-ducking").checked,
        hyperframesRender: byId("render-hf-render").checked,
        hyperframesValidate: byId("render-hf-validate").checked,
        renderer: byId("render-renderer").value,
        subtitles: byId("render-subtitles").checked,
      };
      maybe(options, "sourceVolume", optionalNumber("render-source-volume"));
      maybe(options, "voiceoverVolume", optionalNumber("render-voiceover-volume"));
      maybe(options, "hyperframesCommand", optionalStringArray("render-hf-command"));
      maybe(options, "hyperframesOutput", optionalString("render-hf-output"));
      return options;
    };
    const artifactRow = (artifact) => {
      const row = tableRow([artifact.name, artifact.kind, artifact.size]);
      const actionCell = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Preview";
      button.addEventListener("click", () => void previewArtifact(artifact.name));
      actionCell.append(button);
      row.append(actionCell);
      return row;
    };
    const formatPreview = (value) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const previewArtifact = async (name) => {
      byId("artifact-preview").textContent = "Loading " + name + "...";
      try {
        const artifact = await api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts/" + encodeURIComponent(name));
        byId("artifact-preview").textContent = formatPreview(artifact.content);
      } catch (error) {
        byId("artifact-preview").textContent = error instanceof Error ? error.message : String(error);
      }
    };
    const renderVisualSamples = (samples) => {
      const target = byId("visual-samples");
      target.textContent = "";
      const available = samples.filter((sample) => sample.exists && sample.contentBase64 !== undefined);
      if (available.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No visual samples";
        target.append(empty);
        return;
      }
      for (const sample of available) {
        const card = document.createElement("div");
        card.className = "sample";
        const image = document.createElement("img");
        image.alt = "Frame sample at " + sample.timestamp + "s";
        image.src = "data:image/jpeg;base64," + sample.contentBase64;
        const meta = document.createElement("p");
        meta.className = "muted";
        meta.textContent = sample.timestamp + "s " + (sample.relativePath ?? "");
        card.append(image, meta);
        target.append(card);
      }
    };
    const severityBadge = (severity) => {
      const badge = document.createElement("span");
      badge.className = "severity severity--" + severity;
      badge.textContent = severity;
      return badge;
    };
    const issueRow = (issue) => {
      const row = document.createElement("tr");
      const severity = document.createElement("td");
      severity.append(severityBadge(issue.severity ?? "warning"));
      const code = document.createElement("td");
      code.textContent = text(issue.code);
      const message = document.createElement("td");
      message.textContent = text(issue.message);
      row.append(severity, code, message);
      return row;
    };
    const qualityIssueRow = (area, issue) => {
      const row = document.createElement("tr");
      const areaCell = document.createElement("td");
      areaCell.textContent = area;
      const severity = document.createElement("td");
      severity.append(severityBadge(issue.severity ?? "warning"));
      const code = document.createElement("td");
      code.textContent = text(issue.code);
      const message = document.createElement("td");
      message.textContent = text(issue.message);
      row.append(areaCell, severity, code, message);
      return row;
    };
    const qualityCount = (quality) => quality === undefined ? "not checked" : quality.errors + " errors, " + quality.warnings + " warnings";
    const renderQualityRows = (renderOutput) => {
      const sections = [
        ["Output", renderOutput?.outputQuality],
        ["Audio", renderOutput?.audioQuality],
        ["Subtitles", renderOutput?.subtitleQuality],
        ["Visual", renderOutput?.visualQuality],
      ];
      const rows = sections.flatMap(([area, quality]) => Array.isArray(quality?.issues) ? quality.issues.map((issue) => qualityIssueRow(area, issue)) : []);
      for (const warning of renderOutput?.audioDiagnostics?.warnings ?? []) {
        rows.push(qualityIssueRow("Audio", {code: "audio.diagnostic.warning", message: warning, severity: "warning"}));
      }
      for (const missing of renderOutput?.audioDiagnostics?.missingVoiceovers ?? []) {
        rows.push(qualityIssueRow("Audio", {code: "audio.voiceover.missing", message: "Missing voiceover " + text(missing.narrationId ?? missing.index), severity: "warning"}));
      }
      return rows;
    };
    const renderRenderQuality = (renderOutput) => {
      if (renderOutput === undefined) {
        byId("render-quality-summary").textContent = "No render quality report.";
        setRows("render-quality-issues", [], 4);
        return;
      }
      byId("render-quality-summary").textContent = [
        "output " + qualityCount(renderOutput.outputQuality),
        "audio " + qualityCount(renderOutput.audioQuality),
        "subtitles " + qualityCount(renderOutput.subtitleQuality),
        "visual " + qualityCount(renderOutput.visualQuality),
      ].join(" | ");
      setRows("render-quality-issues", renderQualityRows(renderOutput), 4);
    };
    const renderTemplateQuality = (renderOutput) => {
      const quality = renderOutput?.templateQuality;
      if (quality === undefined) {
        byId("template-summary").textContent = "No template quality report.";
        setRows("template-issues", [], 3);
        return;
      }
      byId("template-summary").textContent = (quality.ok ? "ok" : "needs attention") + " - " + quality.errors + " errors, " + quality.warnings + " warnings";
      setRows("template-issues", Array.isArray(quality.issues) ? quality.issues.map((issue) => issueRow(issue)) : [], 3);
    };
    const loadRenderDiagnostics = async (artifacts) => {
      if (!artifacts.some((artifact) => artifact.name === "render-output.json")) {
        renderTemplateQuality(undefined);
        renderRenderQuality(undefined);
        return;
      }
      try {
        const renderOutput = await api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts/render-output.json");
        renderTemplateQuality(renderOutput.content);
        renderRenderQuality(renderOutput.content);
      } catch {
        renderTemplateQuality(undefined);
        renderRenderQuality(undefined);
      }
    };
    const integrityRow = (status, name, detail) => {
      const row = document.createElement("tr");
      const statusCell = document.createElement("td");
      statusCell.textContent = status;
      const nameCell = document.createElement("td");
      nameCell.textContent = text(name);
      const detailCell = document.createElement("td");
      detailCell.textContent = text(detail);
      row.append(statusCell, nameCell, detailCell);
      return row;
    };
    const renderArtifactIntegrity = (integrity) => {
      if (integrity === undefined) {
        byId("artifact-integrity-summary").textContent = "No artifact integrity report.";
        setRows("artifact-integrity-issues", [], 3);
        return;
      }
      byId("artifact-integrity-summary").textContent = (integrity.ok ? "ok" : "needs attention") + " - " + integrity.checked + " checked, " + integrity.missing.length + " missing, " + integrity.changed.length + " changed, " + integrity.untracked.length + " untracked";
      setRows("artifact-integrity-issues", [
        ...integrity.missing.map((issue) => integrityRow("missing", issue.name, issue.reason)),
        ...integrity.changed.map((issue) => integrityRow("changed", issue.name, "size " + issue.expectedSize + " -> " + issue.actualSize)),
        ...integrity.untracked.map((name) => integrityRow("untracked", name, "not present in artifact-manifest.json")),
      ], 3);
    };
    const guidedActionRow = (action) => {
      const row = tableRow([action.label, action.category, action.description, action.command]);
      const actionCell = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Copy";
      button.addEventListener("click", () => void copyGuidedAction(action.command));
      actionCell.append(button);
      row.append(actionCell);
      return row;
    };
    const renderGuidedActions = (actions) => {
      setRows("guided-actions", actions.map((action) => guidedActionRow(action)), 5);
    };
    const copyGuidedAction = async (command) => {
      try {
        if (navigator.clipboard === undefined) {
          throw new Error("Clipboard API is unavailable.");
        }
        await navigator.clipboard.writeText(command);
        byId("action-status").textContent = "Copied: " + command;
      } catch (error) {
        byId("action-status").textContent = "Copy failed: " + (error instanceof Error ? error.message : String(error));
      }
    };
    const loadGuidedActions = async () => {
      const path = state.projectId === undefined ? "/actions" : "/projects/" + encodeURIComponent(state.projectId) + "/actions";
      try {
        const result = await api(path);
        renderGuidedActions(result.actions);
      } catch {
        renderGuidedActions([]);
      }
    };
    const loadArtifactIntegrity = async () => {
      try {
        renderArtifactIntegrity(await api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts/verify"));
      } catch {
        renderArtifactIntegrity(undefined);
      }
    };
    const defaultRerunStage = (stages) => {
      const resumable = stages.find((stage) => ["failed", "running", "pending"].includes(stage.status));
      return (resumable ?? stages[0])?.name ?? "";
    };
    const renderRerunStages = (stages) => {
      const select = byId("rerun-stage");
      const previous = select.value;
      const fallback = defaultRerunStage(stages);
      select.textContent = "";
      for (const stage of stages) {
        const option = document.createElement("option");
        option.value = stage.name;
        option.textContent = stage.name + " (" + stage.status + ")";
        select.append(option);
      }
      select.value = stages.some((stage) => stage.name === previous) ? previous : fallback;
      select.disabled = stages.length === 0;
    };
    const renderProjects = (projects) => {
      const list = byId("projects");
      list.textContent = "";
      if (projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No projects";
        list.append(empty);
        return;
      }
      if (state.projectId === undefined) state.projectId = projects[0].projectId;
      for (const project of projects) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-pressed", String(project.projectId === state.projectId));
        button.addEventListener("click", () => {
          state.projectId = project.projectId;
          void load();
        });
        const name = document.createElement("strong");
        name.textContent = project.projectId;
        const meta = document.createElement("span");
        meta.className = "muted";
        meta.textContent = project.status + " " + project.updatedAt;
        button.append(name, meta);
        list.append(button);
      }
    };
    const renderSelected = async () => {
      const actionButtons = [byId("render-action"), byId("export-action"), byId("rerun-action"), byId("worker-action")];
      if (state.projectId === undefined) {
        byId("status").textContent = "none";
        byId("quality").textContent = "none";
        byId("render").textContent = "none";
        byId("action-status").textContent = "Select a project to run actions.";
        actionButtons.forEach((button) => { button.disabled = true; });
        renderRerunStages([]);
        setRows("stages", [], 3);
        setRows("artifacts", [], 4);
        setRows("events", [], 3);
        byId("artifact-preview").textContent = "Select an artifact to preview.";
        renderVisualSamples([]);
        renderTemplateQuality(undefined);
        renderRenderQuality(undefined);
        renderArtifactIntegrity(undefined);
        await loadGuidedActions();
        return;
      }
      actionButtons.forEach((button) => { button.disabled = false; });
      const [status, artifacts, events] = await Promise.all([
        api("/projects/" + encodeURIComponent(state.projectId) + "/status"),
        api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts"),
        api("/projects/" + encodeURIComponent(state.projectId) + "/events?limit=8"),
      ]);
      byId("status").textContent = status.job.status;
      byId("quality").textContent = status.summary.quality.issues + " issues";
      byId("render").textContent = status.summary.render.rendered ? "rendered" : "none";
      renderRerunStages(status.job.stages);
      setRows("stages", status.job.stages.map((stage) => tableRow([stage.name, stage.status, stage.attempt ?? ""])), 3);
      setRows("artifacts", artifacts.artifacts.slice(0, 12).map((artifact) => artifactRow(artifact)), 4);
      setRows("events", events.events.map((event) => tableRow([event.time, event.kind, event.event.type ?? event.event.operation ?? ""])), 3);
      byId("artifact-preview").textContent = "Select an artifact to preview.";
      await Promise.all([
        loadRenderDiagnostics(artifacts.artifacts),
        loadArtifactIntegrity(),
        loadGuidedActions(),
      ]);
      try {
        const visual = await api("/projects/" + encodeURIComponent(state.projectId) + "/visual?includeContent=true");
        renderVisualSamples(visual.samples);
      } catch {
        renderVisualSamples([]);
      }
    };
    const runAction = async (label, action) => {
      if (state.projectId === undefined) return;
      byId("action-status").textContent = label + " running...";
      try {
        const result = await action();
        byId("action-status").textContent = label + " complete: " + JSON.stringify(result);
        await load();
      } catch (error) {
        byId("action-status").textContent = label + " failed: " + (error instanceof Error ? error.message : String(error));
      }
    };
    const runWorkspaceAction = async (label, action) => {
      byId("action-status").textContent = label + " running...";
      try {
        const result = await action();
        byId("action-status").textContent = label + " complete: " + JSON.stringify(result);
        await load();
      } catch (error) {
        byId("action-status").textContent = label + " failed: " + (error instanceof Error ? error.message : String(error));
      }
    };
    const load = async () => {
      const [health, providerEnv, config, projects] = await Promise.all([
        api("/health"),
        api("/provider-env"),
        api("/config"),
        api("/projects"),
      ]);
      byId("workspace").textContent = health.workspaceDir;
      byId("workspace-summary").textContent = health.workspaceDir;
      renderProviderEnvironment(providerEnv);
      renderConfig(config);
      renderProjects(projects.projects);
      await renderSelected();
    };
    byId("refresh").addEventListener("click", () => void load());
    byId("render-action").addEventListener("click", () => void runAction("Render", () => api("/projects/" + encodeURIComponent(state.projectId) + "/render", {
      body: JSON.stringify(readRenderOptions()),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("export-action").addEventListener("click", () => void runAction("Export", () => api("/projects/" + encodeURIComponent(state.projectId) + "/export", {
      body: JSON.stringify({format: "video", requireQuality: true}),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("rerun-action").addEventListener("click", () => void runAction("Rerun", () => api("/projects/" + encodeURIComponent(state.projectId) + "/rerun", {
      body: JSON.stringify({fromStage: byId("rerun-stage").value || undefined}),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("worker-action").addEventListener("click", () => void runAction("Worker dry-run", () => api("/worker", {
      body: JSON.stringify({dryRun: true, orderBy: "oldest", runningStaleAfterMs: 60000, status: "active"}),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("provider-test-action").addEventListener("click", () => void runWorkspaceAction("Provider test", () => api("/provider-test", {
      body: JSON.stringify({role: "all"}),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    void load();
  </script>
</body>
</html>
`
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

function htmlResponse(value: string): Response {
  return new Response(value, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
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
          code: 'checkpoint_invalid',
          fromStage: error.fromStage,
          message: error.message,
          missingArtifacts: error.missingArtifacts,
          name: error.name,
          schemaInvalidArtifacts: error.schemaInvalidArtifacts,
          untrackedArtifacts: error.untrackedArtifacts,
        },
      },
      {status: 409},
    )
  }

  if (error instanceof ZodError) {
    return jsonResponse(
      {
        error: {
          code: 'validation_error',
          issues: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path.map(String),
          })),
          message: 'Validation failed.',
        },
      },
      {status: 422},
    )
  }

  if (error instanceof ExportQualityError) {
    return jsonResponse(
      {
        error: {
          code: 'export_quality_failed',
          message: error.message,
          name: error.name,
          projectId: error.projectId,
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

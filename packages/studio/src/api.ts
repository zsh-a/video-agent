import type {
  ArtifactIntegrity,
  ArtifactSummary,
  DashboardData,
  GuidedAction,
  ProjectEvent,
  ProjectStatus,
  ProviderReport,
  QualityDetails,
  RenderOutput,
  VisualSample,
} from './types'
import {emptyData} from './types'

export async function loadWorkspaceActions(): Promise<DashboardData> {
  const actions = await api<{actions: GuidedAction[]}>('/actions')
  return {...emptyData, actions: actions.actions}
}

export async function loadProjectData(projectId: string): Promise<DashboardData> {
  const [status, artifacts, events, providerReport, quality, actions, integrity] = await Promise.all([
    api<ProjectStatus>(`/projects/${encodeURIComponent(projectId)}/status`),
    api<{artifacts: ArtifactSummary[]}>(`/projects/${encodeURIComponent(projectId)}/artifacts`),
    api<{events: ProjectEvent[]}>(`/projects/${encodeURIComponent(projectId)}/events?limit=8`),
    api<ProviderReport>(`/projects/${encodeURIComponent(projectId)}/provider-report`),
    api<QualityDetails>(`/projects/${encodeURIComponent(projectId)}/quality?details=true`),
    api<{actions: GuidedAction[]}>(`/projects/${encodeURIComponent(projectId)}/actions`),
    api<ArtifactIntegrity>(`/projects/${encodeURIComponent(projectId)}/artifacts/verify`).catch(() => undefined),
  ])
  const [visualSamples, renderOutput] = await Promise.all([
    api<{samples: VisualSample[]}>(`/projects/${encodeURIComponent(projectId)}/visual?includeContent=true`).then((result) => result.samples).catch(() => []),
    artifacts.artifacts.some((artifact) => artifact.name === 'render-output.json')
      ? api<{content: RenderOutput}>(`/projects/${encodeURIComponent(projectId)}/artifacts/render-output.json`).then((result) => result.content).catch(() => undefined)
      : undefined,
  ])

  return {
    actions: actions.actions,
    artifacts: artifacts.artifacts,
    events: events.events,
    integrity,
    projectStatus: status,
    providerReport,
    projects: [],
    quality,
    renderOutput,
    visualSamples,
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options)
  if (!response.ok) throw await createApiError(response)
  return response.json() as Promise<T>
}

export function jsonPost(body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {'content-type': 'application/json'},
    method: 'POST',
  }
}

async function createApiError(response: Response): Promise<Error> {
  const bodyText = await response.text()
  let body: {error?: Record<string, unknown>} | undefined
  try {
    body = JSON.parse(bodyText) as {error?: Record<string, unknown>}
  } catch {
    body = undefined
  }
  return new Error(formatApiError(response.status, body?.error, bodyText))
}

function formatApiError(status: number, error: Record<string, unknown> | undefined, fallback: string): string {
  if (error?.code === 'checkpoint_invalid') {
    return [
      `HTTP ${status} checkpoint_invalid: ${String(error.message ?? 'Checkpoint artifacts are invalid.')}`,
      `missing: ${listText(error.missingArtifacts)}`,
      `changed: ${listText(error.changedArtifacts)}`,
      `schema invalid: ${listText(error.schemaInvalidArtifacts)}`,
      `untracked: ${listText(error.untrackedArtifacts)}`,
    ].join(' | ')
  }

  if (error?.code === 'export_quality_failed') {
    const quality = (error.quality as {summary?: {errors: number; warnings: number}} | undefined)?.summary
    const qualityText = quality === undefined ? 'quality report unavailable' : `${quality.errors} errors, ${quality.warnings} warnings`
    return `HTTP ${status} export_quality_failed: ${qualityText} - ${String(error.message ?? 'Project quality gate failed.')}`
  }

  if (error?.code === 'validation_error') {
    const issues = Array.isArray(error.issues)
      ? error.issues.map((issue) => {
        const typedIssue = issue as {message?: string; path?: string[]}
        return `${typedIssue.path?.join('.') ?? ''}: ${typedIssue.message ?? ''}`
      }).join('; ')
      : 'no issue details'
    return `HTTP ${status} validation_error: ${issues}`
  }

  return `HTTP ${status}: ${String(error?.message ?? fallback)}`
}

function listText(value: unknown): string {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : 'none'
}

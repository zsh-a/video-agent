import type {
  ArtifactIntegrity,
  ProviderEnvironment,
  QualityCount,
  QualityIssue,
  RenderOutput,
  StageSummary,
  UsageSummary,
} from './types'

export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function defaultRerunStage(stages: StageSummary[]): string {
  return (stages.find((stage) => ['failed', 'running', 'pending'].includes(stage.status)) ?? stages[0])?.name ?? ''
}

export function summarizeProviderEnvironment(report: ProviderEnvironment | undefined) {
  if (report === undefined) return undefined
  const requirements = report.providers.flatMap((provider) => provider.requirements)
  return {
    configured: requirements.filter((requirement) => requirement.configured).length,
    missingRequired: requirements.filter((requirement) => requirement.required && !requirement.configured).map((requirement) => requirement.env),
    total: requirements.length,
  }
}

export function formatUsage(usage: UsageSummary | undefined): string {
  if (usage === undefined) return 'none'
  const tokens = usage.totalTokens ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))
  const parts = [
    tokens > 0 ? `${tokens} tok` : undefined,
    usage.inputTokens !== undefined ? `${usage.inputTokens} in` : undefined,
    usage.outputTokens !== undefined ? `${usage.outputTokens} out` : undefined,
    usage.audioSeconds !== undefined ? `${usage.audioSeconds}s audio` : undefined,
  ].filter((part) => part !== undefined)
  return parts.length === 0 ? 'none' : parts.join(', ')
}

export function qualityCount(quality: QualityCount | undefined): string {
  return quality === undefined ? 'not checked' : `${quality.errors} errors, ${quality.warnings} warnings`
}

export function renderQualityRows(renderOutput: RenderOutput | undefined): Array<{area: string; issue: QualityIssue}> {
  const sections: Array<[string, QualityCount | undefined]> = [
    ['Output', renderOutput?.outputQuality],
    ['Audio', renderOutput?.audioQuality],
    ['Subtitles', renderOutput?.subtitleQuality],
    ['Visual', renderOutput?.visualQuality],
  ]
  const rows = sections.flatMap(([area, quality]) => (quality?.issues ?? []).map((issue) => ({area, issue})))
  for (const warning of renderOutput?.audioDiagnostics?.warnings ?? []) {
    rows.push({area: 'Audio', issue: {code: 'audio.diagnostic.warning', message: warning, severity: 'warning'}})
  }
  for (const missing of renderOutput?.audioDiagnostics?.missingVoiceovers ?? []) {
    rows.push({area: 'Audio', issue: {code: 'audio.voiceover.missing', message: `Missing voiceover ${missing.narrationId ?? missing.index}`, severity: 'warning'}})
  }
  return rows
}

export function artifactIntegrityRows(integrity: ArtifactIntegrity | undefined): Array<{detail: string; name: string; status: string}> {
  if (integrity === undefined) return []
  return [
    ...integrity.missing.map((issue) => ({detail: issue.reason ?? '', name: issue.name, status: 'missing'})),
    ...integrity.changed.map((issue) => ({detail: `size ${issue.expectedSize} -> ${issue.actualSize}`, name: issue.name, status: 'changed'})),
    ...(integrity.schemaInvalid ?? []).map((issue) => ({detail: issue.issues.map((schemaIssue) => `${schemaIssue.path.join('.') || '<root>'}: ${schemaIssue.message}`).join('; '), name: issue.name, status: 'schema invalid'})),
    ...integrity.untracked.map((name) => ({detail: 'not present in artifact-manifest.json', name, status: 'untracked'})),
  ]
}

export function projectFileUrl(projectId: string, path: string): string {
  return `/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(path)}`
}

export type ProjectSummary = {
  projectId: string
  status: string
  updatedAt: string
}

export type StageSummary = {
  attempt?: number
  name: string
  status: string
}

export type ArtifactSummary = {
  kind: string
  name: string
  size: number
}

export type RenderSummary = {
  output?: string
  rendered?: boolean
  renderer?: string
  reviewAvailable?: boolean
  reviewHtml?: string
  reviewReport?: string
}

export type ProjectStatus = {
  job: {
    pipeline: string
    stages: StageSummary[]
    status: string
  }
  summary: {
    events: {count: number}
    quality: {errors: number; issues: number; warnings: number}
    render: RenderSummary
  }
}

export type ProviderRequirement = {
  configured: boolean
  env: string
  required: boolean
}

export type ProviderEnvironment = {
  providers: Array<{
    provider: string
    requirements: ProviderRequirement[]
    role: string
  }>
  summary?: {
    configured: number
    missingRequired: string[]
    total: number
  }
}

export type RuntimeConfig = {
  persistence: {jobStore: string}
  pipeline: {maxStageRetries: number; retryBackoffMs: number}
  providers: Record<'asr' | 'script' | 'tts' | 'vlm', string>
}

export type GuidedAction = {
  category: string
  command: string
  description: string
  label: string
}

export type ProjectEvent = {
  event: Record<string, unknown>
  kind: string
  time: string
}

export type VisualSample = {
  contentBase64?: string
  error?: string
  exists?: boolean
  ok: boolean
  path?: string
  relativePath?: string
  size?: number
  timestamp: number
}

export type QualityIssue = {
  code?: string
  message?: string
  severity?: 'error' | 'warning' | string
}

export type QualityDetails = {
  content: {errors: number; warnings: number}
  contentIssues?: QualityIssue[]
  deck: {errors: number; warnings: number}
  deckIssues?: QualityIssue[]
  qualityReport?: {issues?: QualityIssue[]}
  summary: {errors: number; warnings: number}
}

export type UsageSummary = {
  audioSeconds?: number
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type ProviderReport = {
  llmTraces?: Array<{
    durationMs: number
    model?: string
    operation: string
    provider?: string
    requestId: string
    status: string
    usage?: UsageSummary
  }>
  summary?: {
    failed?: number
    llm?: {usage?: UsageSummary}
    total?: number
    usage?: UsageSummary
  }
}

export type RenderOutput = {
  audioDiagnostics?: {
    missingVoiceovers?: Array<{index?: number; narrationId?: string}>
    warnings?: string[]
  }
  audioQuality?: QualityCount
  outputQuality?: QualityCount
  subtitleQuality?: QualityCount
  templateQuality?: QualityCount
  visualQuality?: QualityCount
}

export type QualityCount = {
  errors: number
  issues?: QualityIssue[]
  ok?: boolean
  warnings: number
}

export type ArtifactIntegrity = {
  changed: Array<{actualSize: number; expectedSize: number; name: string}>
  checked: number
  missing: Array<{name: string; reason?: string}>
  ok: boolean
  schemaInvalid?: Array<{issues: Array<{message: string; path: string[]}>; name: string}>
  summary?: {checked: number; errors: number; warnings: number}
  untracked: string[]
}

export type DashboardData = {
  actions: GuidedAction[]
  artifacts: ArtifactSummary[]
  config?: RuntimeConfig
  events: ProjectEvent[]
  health?: {ok: boolean; workspaceDir: string}
  integrity?: ArtifactIntegrity
  projectStatus?: ProjectStatus
  providerEnv?: ProviderEnvironment
  providerReport?: ProviderReport
  projects: ProjectSummary[]
  quality?: QualityDetails
  renderOutput?: RenderOutput
  visualSamples: VisualSample[]
}

export type ActionState = {
  kind: 'error' | 'idle' | 'running' | 'success'
  message: string
}

export type RenderOptions = {
  audio: boolean
  audioDucking: boolean
  sourceVolume?: number
  subtitles: boolean
  voiceoverVolume?: number
}

export type ExportOptions = {
  cleanOutput: boolean
  format?: 'bundle' | 'video'
  outputPath?: string
  requireQuality: boolean
}

export const emptyData: DashboardData = {
  actions: [],
  artifacts: [],
  events: [],
  projects: [],
  visualSamples: [],
}

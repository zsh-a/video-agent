import type {JobState} from '@video-agent/db'

import type {ProviderCallRole} from '../provider/calls.js'
import type {ProjectAgentStatus} from './agent-status.js'

export interface ProjectStatus {
  agent: ProjectAgentStatus
  artifacts: string[]
  job: JobState
  projectDir: string
  projectId: string
  summary: ProjectRuntimeSummary
}

export interface ProjectRuntimeSummary {
  events: {
    count: number
    last?: {
      stage?: string
      time?: string
      type?: string
    }
  }
  providers: {
    byRole: Record<ProviderCallRole, ProviderRoleSummary>
    costs: Record<string, number>
    failed: number
    succeeded: number
    total: number
  }
  quality: QualitySummary
  render: RenderSummary
}

export interface QualitySummary {
  errors: number
  issues: number
  warnings: number
}

export interface RenderSummary {
  audioInputs: number
  audioQualityErrors: number
  audioQualityWarnings: number
  audioWarnings: number
  missingVoiceovers: number
  output?: string
  outputErrors: number
  outputWarnings: number
  rendered: boolean
  renderer?: string
  reviewAvailable: boolean
  reviewHtml?: string
  reviewReport?: string
  subtitleErrors: number
  subtitleWarnings: number
  templateErrors: number
  templateWarnings: number
  visualErrors: number
  visualWarnings: number
}

export interface ProviderRoleSummary {
  costs: Record<string, number>
  failed: number
  succeeded: number
  total: number
}

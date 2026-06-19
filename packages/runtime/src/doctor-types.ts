export type HealthCheckStatus = 'fail' | 'pass' | 'warn'

export interface HealthCheck {
  details?: Record<string, unknown>
  message: string
  name: string
  status: HealthCheckStatus
}

export interface RuntimeHealthOptions {
  binaries?: {
    chromium?: string
    ffmpeg?: string
    ffprobe?: string
  }
  env?: Record<string, string | undefined>
  workspaceDir?: string
}

export interface RuntimeHealthReport {
  checks: HealthCheck[]
  configPath: string
  ok: boolean
  summary: RuntimeHealthSummary
  workspaceDir: string
}

export interface RuntimeHealthSummary {
  fail: number
  pass: number
  total: number
  warn: number
}

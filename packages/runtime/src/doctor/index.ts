import {resolve} from 'node:path'

import {resolveConfigPath} from '../shared/config.js'
import type {HealthCheck, RuntimeHealthOptions, RuntimeHealthReport} from './types.js'
import {checkProviderConfig} from './provider-checks.js'
import {summarizeHealthChecks} from './summary.js'
import {checkBinary, checkBunRuntime, checkConfig, checkProjectListing, checkWorkspaceAccess} from './system-checks.js'

export type {
  HealthCheck,
  HealthCheckStatus,
  RuntimeHealthOptions,
  RuntimeHealthReport,
  RuntimeHealthSummary,
} from './types.js'

export async function checkRuntimeHealth(options: RuntimeHealthOptions = {}): Promise<RuntimeHealthReport> {
  const workspaceDir = resolve(options.workspaceDir ?? '.video-agent')
  const checks: HealthCheck[] = [
    checkBunRuntime(),
    await checkWorkspaceAccess(workspaceDir),
    await checkConfig(workspaceDir),
    ...(await checkProviderConfig(workspaceDir, options.env)),
    await checkProjectListing(workspaceDir),
    await checkBinary('ffmpeg', options.binaries?.ffmpeg ?? 'ffmpeg'),
    await checkBinary('ffprobe', options.binaries?.ffprobe ?? 'ffprobe'),
    await checkBinary('chromium', options.binaries?.chromium ?? 'chromium'),
  ]

  return {
    checks,
    configPath: resolveConfigPath(workspaceDir),
    ok: checks.every((check) => check.status !== 'fail'),
    summary: summarizeHealthChecks(checks),
    workspaceDir,
  }
}

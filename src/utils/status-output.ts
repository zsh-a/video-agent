import type {ProjectStatus} from '@video-agent/runtime'

import {formatQualityRenderSummary} from './quality-output.js'

export function formatProjectStatus(status: ProjectStatus): string {
  return [
    `Project: ${status.projectId}`,
    `Status: ${status.job.status}`,
    `Artifacts: ${status.artifacts.length}`,
    `Events: ${status.summary.events.count}`,
    `Provider calls: ${status.summary.providers.total} (${status.summary.providers.failed} failed)`,
    `Quality issues: ${status.summary.quality.issues} (${status.summary.quality.errors} errors, ${status.summary.quality.warnings} warnings)`,
    `Render: ${formatQualityRenderSummary(status.summary.render)}`,
    ...(status.summary.events.last === undefined ? [] : [`Last event: ${status.summary.events.last.type ?? 'unknown'}${status.summary.events.last.stage === undefined ? '' : `:${status.summary.events.last.stage}`}`]),
    ...status.job.stages.map((stage) => `${stage.name}: ${stage.status}`),
  ].join('\n')
}

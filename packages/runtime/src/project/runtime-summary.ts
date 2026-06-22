import {resolve} from 'node:path'

import type {ProjectRuntimeSummary} from './status-types.js'
import type {z} from 'zod'

import {QUALITY_REPORT_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME} from '../artifacts/artifact-names.js'
import {PIPELINE_EVENTS_LOG_ARTIFACT_NAME, PROVIDER_CALLS_LOG_ARTIFACT_NAME} from '../artifacts/log-artifact-names.js'
import {PipelineEventLogLineSchema, ProviderCallLogLineSchema} from '../artifacts/log-schemas.js'
import {readParsedJsonLines} from '../shared/file-io.js'
import {summarizeEvents} from './event-summary.js'
import {summarizeProviderCalls} from './provider-summary.js'
import {readQualitySummary} from './quality-summary.js'
import {readRenderSummary} from './render-summary.js'

export async function readProjectRuntimeSummary(artifactsDir: string): Promise<ProjectRuntimeSummary> {
  const [events, providerCalls, quality, render] = await Promise.all([
    readStatusJsonLines(resolve(artifactsDir, PIPELINE_EVENTS_LOG_ARTIFACT_NAME), PipelineEventLogLineSchema),
    readStatusJsonLines(resolve(artifactsDir, PROVIDER_CALLS_LOG_ARTIFACT_NAME), ProviderCallLogLineSchema),
    readQualitySummary(resolve(artifactsDir, QUALITY_REPORT_ARTIFACT_NAME)),
    readRenderSummary(resolve(artifactsDir, RENDER_OUTPUT_ARTIFACT_NAME)),
  ])

  return {
    events: summarizeEvents(events),
    providers: summarizeProviderCalls(providerCalls),
    quality,
    render,
  }
}

async function readStatusJsonLines<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  return readParsedJsonLines(path, schema)
}

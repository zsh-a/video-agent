import {resolve} from 'node:path'

import type {ProviderCallRecord} from '../provider/calls.js'
import type {ProjectRuntimeSummary} from './status-types.js'

import {readJsonLines} from '../shared/file-io.js'
import {summarizeEvents, type PipelineEventLike} from './event-summary.js'
import {summarizeProviderCalls} from './provider-summary.js'
import {readQualitySummary} from './quality-summary.js'
import {readRenderSummary} from './render-summary.js'

export async function readProjectRuntimeSummary(artifactsDir: string): Promise<ProjectRuntimeSummary> {
  const [events, providerCalls, quality, render] = await Promise.all([
    readJsonLines<PipelineEventLike>(resolve(artifactsDir, 'pipeline-events.jsonl')),
    readJsonLines<ProviderCallRecord>(resolve(artifactsDir, 'provider-calls.jsonl')),
    readQualitySummary(resolve(artifactsDir, 'quality-report.json')),
    readRenderSummary(resolve(artifactsDir, 'render-output.json')),
  ])

  return {
    events: summarizeEvents(events),
    providers: summarizeProviderCalls(providerCalls),
    quality,
    render,
  }
}

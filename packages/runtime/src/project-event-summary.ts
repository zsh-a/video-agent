import type {ProjectRuntimeSummary} from './project-status-types.js'

export function summarizeEvents(events: PipelineEventLike[]): ProjectRuntimeSummary['events'] {
  const last = events.at(-1)

  return {
    count: events.length,
    ...(last === undefined
      ? {}
      : {
          last: {
            ...(typeof last.stage === 'string' ? {stage: last.stage} : {}),
            ...(typeof last.time === 'string' ? {time: last.time} : {}),
            ...(typeof last.type === 'string' ? {type: last.type} : {}),
          },
        }),
  }
}

export interface PipelineEventLike {
  stage?: unknown
  time?: unknown
  type?: unknown
}

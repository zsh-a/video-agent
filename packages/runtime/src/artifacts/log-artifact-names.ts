export const PIPELINE_EVENTS_LOG_ARTIFACT_NAME = 'pipeline-events.jsonl' as const
export const PROVIDER_CALLS_LOG_ARTIFACT_NAME = 'provider-calls.jsonl' as const
export const LLM_TRACES_LOG_ARTIFACT_NAME = 'llm-traces.jsonl' as const

export const PROJECT_LOG_ARTIFACT_NAMES = [
  PIPELINE_EVENTS_LOG_ARTIFACT_NAME,
  PROVIDER_CALLS_LOG_ARTIFACT_NAME,
  LLM_TRACES_LOG_ARTIFACT_NAME,
] as const

export type ProjectLogArtifactName = (typeof PROJECT_LOG_ARTIFACT_NAMES)[number]

import type {ZodType} from 'zod'

import {ASRResultSchema, CharacterIndexSchema, ClaimsSchema, ClipPlanSchema, ContentBlocksSchema, DeckQualityReportSchema, DeckSchema, DocumentSchema, FilmScenesSchema, LongVideoAnalysisFramesSchema, LongVideoChapterSummariesSchema, LongVideoChunkPlanSchema, LongVideoChunkSilenceSchema, LongVideoChunkSummariesSchema, LongVideoChunkSummarySchema, LongVideoGlobalOutlineSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, NarrativeBeatsSchema, OutlineSchema, OutputNarrationSchema, OutputTimelineMapSchema, RecapScriptSchema, SilencePeriodsSchema, SourceManifestSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryIndexSchema, StoryboardSchema, TimedDeckSchema, TimelineFusionSchema, TimelineSchema, VLMAnalysisSchema} from '@video-agent/ir'
import {SceneFrameBatchesSchema, TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {AudioMixSchema, ExportOutputSchema, IngestReportSchema, QualityReportSchema, RenderOutputSchema, SubtitleOutputSchema, VoiceoverPlanSchema} from './artifact-core-schemas.js'
import {DeckFrameManifestSchema, DeckFrameShardBatchSchema, DeckFrameShardPlanSchema, DeckFrameShardSchema, DeckKeyframesSchema, DeckRendererBackendProjectSchema, DeckRendererRemotionOutputSchema, DeckReviewReportSchema, DeckVoiceoverSchema} from './deck-artifact-schemas.js'
import {LLMTraceLogLineSchema, PipelineEventLogLineSchema, ProviderCallLogLineSchema} from './artifact-log-schemas.js'

import type {ArtifactSchemaInvalidIssue, ArtifactSchemaIssue} from './artifacts.js'

const ARTIFACT_SCHEMAS: Record<string, ZodType> = {
  'audio-mix.json': AudioMixSchema,
  'asr-result.json': ASRResultSchema,
  'character-index.json': CharacterIndexSchema,
  'chapters.json': LongVideoChapterSummariesSchema,
  'chunk-plan.json': LongVideoChunkPlanSchema,
  'chunk-summaries.json': LongVideoChunkSummariesSchema,
  'claims.json': ClaimsSchema,
  'clip-plan.json': ClipPlanSchema,
  'clip-plan-validated.json': ClipPlanSchema,
  'content-blocks.json': ContentBlocksSchema,
  'deck-frame-manifest.json': DeckFrameManifestSchema,
  'deck-frame-shard-batch.json': DeckFrameShardBatchSchema,
  'deck-frame-shard-plan.json': DeckFrameShardPlanSchema,
  'deck-renderer-motion-canvas.json': DeckRendererBackendProjectSchema,
  'deck-renderer-remotion.json': DeckRendererBackendProjectSchema,
  'deck-renderer-remotion-output.json': DeckRendererRemotionOutputSchema,
  'deck-keyframes.json': DeckKeyframesSchema,
  'deck-voiceover.json': DeckVoiceoverSchema,
  'deck-quality-report.json': DeckQualityReportSchema,
  'review-report.json': DeckReviewReportSchema,
  'deck.json': DeckSchema,
  'document.json': DocumentSchema,
  'export-output.json': ExportOutputSchema,
  'frames.json': LongVideoAnalysisFramesSchema,
  'global-outline.json': LongVideoGlobalOutlineSchema,
  'ingest-report.json': IngestReportSchema,
  'media-info.json': MediaInfoSchema,
  'narration.json': NarrationSchema,
  'outline.json': OutlineSchema,
  'output-narration.json': OutputNarrationSchema,
  'output-timeline-map.json': OutputTimelineMapSchema,
  'quality-report.json': QualityReportSchema,
  'recap-script.json': RecapScriptSchema,
  'render-output.json': RenderOutputSchema,
  'scene-analysis.json': VlmScenesSchema,
  'scene-batches.json': SceneFrameBatchesSchema,
  'scenes.json': FilmScenesSchema,
  'selected-moments.json': LongVideoSelectedMomentsSchema,
  'silence-periods.json': SilencePeriodsSchema,
  'speaker-script.json': SpeakerScriptSchema,
  'source-manifest.json': SourceManifestSchema,
  'source-quotes.json': SourceQuotesSchema,
  'story-index.json': StoryIndexSchema,
  'storyboard.json': StoryboardSchema,
  'subtitles.json': SubtitleOutputSchema,
  'narrative-beats.json': NarrativeBeatsSchema,
  'timed-deck.json': TimedDeckSchema,
  'timeline-fusion.json': TimelineFusionSchema,
  'timeline.json': TimelineSchema,
  'transcript.json': TranscriptSchema,
  'tts-segments.json': TtsSegmentsSchema,
  'vlm-analysis.json': VLMAnalysisSchema,
  'voiceover-plan.json': VoiceoverPlanSchema,
}

const NESTED_ARTIFACT_SCHEMAS: Array<{pattern: RegExp; schema: ZodType}> = [
  {pattern: /^deck-frame-shard-\d{6}-\d{6}\.json$/, schema: DeckFrameShardSchema},
  {pattern: /^chunks\/[^/]+\/summary\.json$/, schema: LongVideoChunkSummarySchema},
  {pattern: /^chunks\/[^/]+\/silence\.json$/, schema: LongVideoChunkSilenceSchema},
  {pattern: /^chunks\/[^/]+\/transcript\.json$/, schema: TranscriptSchema},
  {pattern: /^chunks\/[^/]+\/vlm\.json$/, schema: VlmScenesSchema},
]

const ARTIFACT_JSONL_SCHEMAS: Record<string, ZodType> = {
  'llm-traces.jsonl': LLMTraceLogLineSchema,
  'pipeline-events.jsonl': PipelineEventLogLineSchema,
  'provider-calls.jsonl': ProviderCallLogLineSchema,
}

export function validateKnownArtifactSchema(name: string, content: Uint8Array): ArtifactSchemaInvalidIssue | undefined {
  const schema = findArtifactSchema(name)

  if (schema !== undefined) {
    return validateJsonArtifactSchema(name, content, schema)
  }

  const jsonlSchema = ARTIFACT_JSONL_SCHEMAS[name]

  return jsonlSchema === undefined ? undefined : validateJsonlArtifactSchema(name, content, jsonlSchema)
}

function validateJsonArtifactSchema(name: string, content: Uint8Array, schema: ZodType): ArtifactSchemaInvalidIssue | undefined {
  let value: unknown

  try {
    value = JSON.parse(new TextDecoder().decode(content))
  } catch (error) {
    return {
      issues: [{
        code: 'invalid_json',
        message: error instanceof Error ? error.message : 'Invalid JSON',
        path: [],
      }],
      name,
    }
  }

  const result = schema.safeParse(value)

  if (result.success) {
    return undefined
  }

  return {
    issues: result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String),
    })),
    name,
  }
}

function validateJsonlArtifactSchema(name: string, content: Uint8Array, schema: ZodType): ArtifactSchemaInvalidIssue | undefined {
  const issues: ArtifactSchemaIssue[] = []
  const lines = new TextDecoder().decode(content).split('\n')

  lines.forEach((line, index) => {
    const lineNumber = String(index + 1)

    if (line.trim().length === 0) {
      return
    }

    let value: unknown

    try {
      value = JSON.parse(line)
    } catch (error) {
      issues.push({
        code: 'invalid_json',
        message: error instanceof Error ? error.message : 'Invalid JSON',
        path: [lineNumber],
      })
      return
    }

    const result = schema.safeParse(value)

    if (!result.success) {
      issues.push(...result.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: [lineNumber, ...issue.path.map(String)],
      })))
    }
  })

  return issues.length === 0 ? undefined : {issues, name}
}

function findArtifactSchema(name: string): ZodType | undefined {
  return ARTIFACT_SCHEMAS[name] ?? NESTED_ARTIFACT_SCHEMAS.find((item) => item.pattern.test(name))?.schema
}

import type {ZodType} from 'zod'
import type {ArtifactKind} from './files.js'

import {ASRResultSchema, CharacterIndexSchema, ClaimsSchema, ClipPlanSchema, ContentBlocksSchema, DeckBriefSchema, DeckCoherenceReportSchema, DeckContentAnalysisSchema, DeckCoverageReportSchema, DeckQualityReportSchema, DeckSchema, DeckScriptTimingReportSchema, DeckSlideOutlineSchema, DeckSourceMapSchema, DeckTimingDriftReportSchema, DocumentSchema, FilmAudioMixSchema, FilmScenesSchema, FilmSubtitleOutputSchema, LongVideoAnalysisFramesSchema, LongVideoChapterSummariesSchema, LongVideoChunkPlanSchema, LongVideoChunkSilenceSchema, LongVideoChunkSummariesSchema, LongVideoChunkSummarySchema, LongVideoGlobalOutlineSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, NarrativeBeatsSchema, OutlineSchema, OutputNarrationSchema, OutputTimelineMapSchema, RecapScriptSchema, SilencePeriodsSchema, SourceManifestSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryIndexSchema, StoryboardSchema, TimedDeckSchema, TimelineFusionSchema, TimelineSchema, VLMAnalysisSchema} from '@video-agent/ir'
import {SceneFrameBatchesSchema, TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {ExportOutputSchema, IngestReportSchema, QualityReportSchema, RenderOutputSchema, VoiceoverPlanSchema} from './core-schemas.js'
import {ARTIFACT_MANIFEST_NAME, ASR_RESULT_ARTIFACT_NAME, AUDIO_MIX_ARTIFACT_NAME, CHARACTER_INDEX_ARTIFACT_NAME, CHAPTERS_ARTIFACT_NAME, CHUNK_PLAN_ARTIFACT_NAME, CHUNK_SUMMARIES_ARTIFACT_NAME, CLAIMS_ARTIFACT_NAME, CLIP_PLAN_ARTIFACT_NAME, CLIP_PLAN_VALIDATED_ARTIFACT_NAME, CONTENT_ANALYSIS_ARTIFACT_NAME, CONTENT_BLOCKS_ARTIFACT_NAME, DECK_ARTIFACT_NAME, DECK_BRIEF_ARTIFACT_NAME, DECK_COHERENCE_REPORT_ARTIFACT_NAME, DECK_COVERAGE_REPORT_ARTIFACT_NAME, DECK_QUALITY_REPORT_ARTIFACT_NAME, DECK_TIMING_REPORT_ARTIFACT_NAME, DECK_VOICEOVER_ARTIFACT_NAME, DOCUMENT_ARTIFACT_NAME, EXPORT_OUTPUT_ARTIFACT_NAME, FRAMES_ARTIFACT_NAME, GLOBAL_OUTLINE_ARTIFACT_NAME, INGEST_REPORT_ARTIFACT_NAME, MEDIA_INFO_ARTIFACT_NAME, NARRATION_ARTIFACT_NAME, NARRATIVE_BEATS_ARTIFACT_NAME, OUTLINE_ARTIFACT_NAME, OUTPUT_NARRATION_ARTIFACT_NAME, OUTPUT_TIMELINE_MAP_ARTIFACT_NAME, QUALITY_REPORT_ARTIFACT_NAME, RECAP_SCRIPT_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME, REVIEW_REPORT_ARTIFACT_NAME, SCENE_ANALYSIS_ARTIFACT_NAME, SCENE_BATCHES_ARTIFACT_NAME, SCENES_ARTIFACT_NAME, SCRIPT_TIMING_REPORT_ARTIFACT_NAME, SELECTED_MOMENTS_ARTIFACT_NAME, SILENCE_PERIODS_ARTIFACT_NAME, SLIDE_OUTLINE_ARTIFACT_NAME, SOURCE_MANIFEST_ARTIFACT_NAME, SOURCE_MAP_ARTIFACT_NAME, SOURCE_QUOTES_ARTIFACT_NAME, SPEAKER_SCRIPT_ARTIFACT_NAME, STORYBOARD_ARTIFACT_NAME, STORY_INDEX_ARTIFACT_NAME, SUBTITLES_ARTIFACT_NAME, TIMELINE_ARTIFACT_NAME, TIMELINE_FUSION_ARTIFACT_NAME, TRANSCRIPT_ARTIFACT_NAME, TTS_SEGMENTS_ARTIFACT_NAME, VLM_ANALYSIS_ARTIFACT_NAME, VOICEOVER_PLAN_ARTIFACT_NAME} from './artifact-names.js'
import {DECK_FRAME_MANIFEST_ARTIFACT_NAME, DECK_FRAME_SHARD_BATCH_ARTIFACT_NAME, DECK_FRAME_SHARD_PLAN_ARTIFACT_NAME, DECK_KEYFRAMES_ARTIFACT_NAME, DECK_RENDERER_MOTION_CANVAS_ARTIFACT_NAME, DECK_RENDERER_REMOTION_ARTIFACT_NAME, DECK_RENDERER_REMOTION_OUTPUT_ARTIFACT_NAME, TIMED_DECK_ARTIFACT_NAME} from './deck-artifact-constants.js'
import {DeckFrameManifestSchema, DeckFrameShardBatchSchema, DeckFrameShardPlanSchema, DeckFrameShardSchema, DeckKeyframesSchema, DeckRendererBackendProjectSchema, DeckRendererRemotionOutputSchema, DeckReviewReportSchema, DeckVoiceoverSchema} from './deck-schemas.js'
import {LLM_TRACES_LOG_ARTIFACT_NAME, PIPELINE_EVENTS_LOG_ARTIFACT_NAME, PROVIDER_CALLS_LOG_ARTIFACT_NAME} from './log-artifact-names.js'
import {LLMTraceLogLineSchema, PipelineEventLogLineSchema, ProviderCallLogLineSchema} from './log-schemas.js'
import {JsonFileParseError, parseJsonLinesTextWithIssues, parseJsonText} from '../shared/file-io.js'
import {JSON_ARTIFACT_KIND, LOG_ARTIFACT_KIND, OTHER_ARTIFACT_KIND} from './files.js'

import type {ArtifactSchemaInvalidIssue, ArtifactSchemaIssue} from './index.js'

const ARTIFACT_SCHEMAS: Record<string, ZodType> = {
  [AUDIO_MIX_ARTIFACT_NAME]: FilmAudioMixSchema,
  [ASR_RESULT_ARTIFACT_NAME]: ASRResultSchema,
  [CHARACTER_INDEX_ARTIFACT_NAME]: CharacterIndexSchema,
  [CHAPTERS_ARTIFACT_NAME]: LongVideoChapterSummariesSchema,
  [CHUNK_PLAN_ARTIFACT_NAME]: LongVideoChunkPlanSchema,
  [CHUNK_SUMMARIES_ARTIFACT_NAME]: LongVideoChunkSummariesSchema,
  [CLAIMS_ARTIFACT_NAME]: ClaimsSchema,
  [CLIP_PLAN_ARTIFACT_NAME]: ClipPlanSchema,
  [CLIP_PLAN_VALIDATED_ARTIFACT_NAME]: ClipPlanSchema,
  [CONTENT_BLOCKS_ARTIFACT_NAME]: ContentBlocksSchema,
  [CONTENT_ANALYSIS_ARTIFACT_NAME]: DeckContentAnalysisSchema,
  [DECK_BRIEF_ARTIFACT_NAME]: DeckBriefSchema,
  [DECK_COHERENCE_REPORT_ARTIFACT_NAME]: DeckCoherenceReportSchema,
  [DECK_COVERAGE_REPORT_ARTIFACT_NAME]: DeckCoverageReportSchema,
  [DECK_FRAME_MANIFEST_ARTIFACT_NAME]: DeckFrameManifestSchema,
  [DECK_FRAME_SHARD_BATCH_ARTIFACT_NAME]: DeckFrameShardBatchSchema,
  [DECK_FRAME_SHARD_PLAN_ARTIFACT_NAME]: DeckFrameShardPlanSchema,
  [DECK_RENDERER_MOTION_CANVAS_ARTIFACT_NAME]: DeckRendererBackendProjectSchema,
  [DECK_RENDERER_REMOTION_ARTIFACT_NAME]: DeckRendererBackendProjectSchema,
  [DECK_RENDERER_REMOTION_OUTPUT_ARTIFACT_NAME]: DeckRendererRemotionOutputSchema,
  [DECK_KEYFRAMES_ARTIFACT_NAME]: DeckKeyframesSchema,
  [DECK_VOICEOVER_ARTIFACT_NAME]: DeckVoiceoverSchema,
  [DECK_QUALITY_REPORT_ARTIFACT_NAME]: DeckQualityReportSchema,
  [DECK_TIMING_REPORT_ARTIFACT_NAME]: DeckTimingDriftReportSchema,
  [REVIEW_REPORT_ARTIFACT_NAME]: DeckReviewReportSchema,
  [DECK_ARTIFACT_NAME]: DeckSchema,
  [DOCUMENT_ARTIFACT_NAME]: DocumentSchema,
  [EXPORT_OUTPUT_ARTIFACT_NAME]: ExportOutputSchema,
  [FRAMES_ARTIFACT_NAME]: LongVideoAnalysisFramesSchema,
  [GLOBAL_OUTLINE_ARTIFACT_NAME]: LongVideoGlobalOutlineSchema,
  [INGEST_REPORT_ARTIFACT_NAME]: IngestReportSchema,
  [MEDIA_INFO_ARTIFACT_NAME]: MediaInfoSchema,
  [NARRATION_ARTIFACT_NAME]: NarrationSchema,
  [OUTLINE_ARTIFACT_NAME]: OutlineSchema,
  [OUTPUT_NARRATION_ARTIFACT_NAME]: OutputNarrationSchema,
  [OUTPUT_TIMELINE_MAP_ARTIFACT_NAME]: OutputTimelineMapSchema,
  [QUALITY_REPORT_ARTIFACT_NAME]: QualityReportSchema,
  [RECAP_SCRIPT_ARTIFACT_NAME]: RecapScriptSchema,
  [RENDER_OUTPUT_ARTIFACT_NAME]: RenderOutputSchema,
  [SCENE_ANALYSIS_ARTIFACT_NAME]: VlmScenesSchema,
  [SCENE_BATCHES_ARTIFACT_NAME]: SceneFrameBatchesSchema,
  [SCENES_ARTIFACT_NAME]: FilmScenesSchema,
  [SELECTED_MOMENTS_ARTIFACT_NAME]: LongVideoSelectedMomentsSchema,
  [SILENCE_PERIODS_ARTIFACT_NAME]: SilencePeriodsSchema,
  [SPEAKER_SCRIPT_ARTIFACT_NAME]: SpeakerScriptSchema,
  [SCRIPT_TIMING_REPORT_ARTIFACT_NAME]: DeckScriptTimingReportSchema,
  [SLIDE_OUTLINE_ARTIFACT_NAME]: DeckSlideOutlineSchema,
  [SOURCE_MAP_ARTIFACT_NAME]: DeckSourceMapSchema,
  [SOURCE_MANIFEST_ARTIFACT_NAME]: SourceManifestSchema,
  [SOURCE_QUOTES_ARTIFACT_NAME]: SourceQuotesSchema,
  [STORY_INDEX_ARTIFACT_NAME]: StoryIndexSchema,
  [STORYBOARD_ARTIFACT_NAME]: StoryboardSchema,
  [SUBTITLES_ARTIFACT_NAME]: FilmSubtitleOutputSchema,
  [NARRATIVE_BEATS_ARTIFACT_NAME]: NarrativeBeatsSchema,
  [TIMED_DECK_ARTIFACT_NAME]: TimedDeckSchema,
  [TIMELINE_FUSION_ARTIFACT_NAME]: TimelineFusionSchema,
  [TIMELINE_ARTIFACT_NAME]: TimelineSchema,
  [TRANSCRIPT_ARTIFACT_NAME]: TranscriptSchema,
  [TTS_SEGMENTS_ARTIFACT_NAME]: TtsSegmentsSchema,
  [VLM_ANALYSIS_ARTIFACT_NAME]: VLMAnalysisSchema,
  [VOICEOVER_PLAN_ARTIFACT_NAME]: VoiceoverPlanSchema,
}

const NESTED_ARTIFACT_SCHEMAS: Array<{pattern: RegExp; schema: ZodType}> = [
  {pattern: /^deck-frame-shard-\d{6}-\d{6}\.json$/, schema: DeckFrameShardSchema},
  {pattern: /^chunks\/[^/]+\/summary\.json$/, schema: LongVideoChunkSummarySchema},
  {pattern: /^chunks\/[^/]+\/silence\.json$/, schema: LongVideoChunkSilenceSchema},
  {pattern: /^chunks\/[^/]+\/transcript\.json$/, schema: TranscriptSchema},
  {pattern: /^chunks\/[^/]+\/vlm\.json$/, schema: VlmScenesSchema},
]

const ARTIFACT_JSONL_SCHEMAS: Record<string, ZodType> = {
  [LLM_TRACES_LOG_ARTIFACT_NAME]: LLMTraceLogLineSchema,
  [PIPELINE_EVENTS_LOG_ARTIFACT_NAME]: PipelineEventLogLineSchema,
  [PROVIDER_CALLS_LOG_ARTIFACT_NAME]: ProviderCallLogLineSchema,
}
const TEXT_DECODER = new TextDecoder()

export function resolveArtifactKind(name: string): ArtifactKind {
  if (isJsonArtifactName(name)) {
    return JSON_ARTIFACT_KIND
  }

  if (ARTIFACT_JSONL_SCHEMAS[name] !== undefined) {
    return LOG_ARTIFACT_KIND
  }

  return OTHER_ARTIFACT_KIND
}

export function isJsonArtifactName(name: string): boolean {
  return name === ARTIFACT_MANIFEST_NAME || findArtifactSchema(name) !== undefined
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
    value = parseJsonText(name, TEXT_DECODER.decode(content))
  } catch (error) {
    if (!(error instanceof JsonFileParseError)) {
      throw error
    }

    return {
      issues: [{
        code: 'invalid_json',
        message: error.details.issues,
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
  const lines = parseJsonLinesTextWithIssues(TEXT_DECODER.decode(content))

  issues.push(...lines.parseIssues.map((issue) => ({
    code: 'invalid_json',
    message: issue.issues,
    path: [String(issue.line)],
  })))

  lines.entries.forEach((line) => {
    const result = schema.safeParse(line.value)

    if (!result.success) {
      issues.push(...result.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: [String(line.line), ...issue.path.map(String)],
      })))
    }
  })

  return issues.length === 0 ? undefined : {issues, name}
}

function findArtifactSchema(name: string): ZodType | undefined {
  return ARTIFACT_SCHEMAS[name] ?? NESTED_ARTIFACT_SCHEMAS.find((item) => item.pattern.test(name))?.schema
}

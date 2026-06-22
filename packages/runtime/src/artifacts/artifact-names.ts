export const ARTIFACT_MANIFEST_NAME = 'artifact-manifest.json' as const
export const ASR_RESULT_ARTIFACT_NAME = 'asr-result.json' as const
export const AUDIO_MIX_ARTIFACT_NAME = 'audio-mix.json' as const
export const CHARACTER_INDEX_ARTIFACT_NAME = 'character-index.json' as const
export const CHAPTERS_ARTIFACT_NAME = 'chapters.json' as const
export const CHUNK_PLAN_ARTIFACT_NAME = 'chunk-plan.json' as const
export const CHUNK_SUMMARIES_ARTIFACT_NAME = 'chunk-summaries.json' as const
export const CLAIMS_ARTIFACT_NAME = 'claims.json' as const
export const CLIP_PLAN_ARTIFACT_NAME = 'clip-plan.json' as const
export const CLIP_PLAN_VALIDATED_ARTIFACT_NAME = 'clip-plan-validated.json' as const
export const CONTENT_ANALYSIS_ARTIFACT_NAME = 'content-analysis.json' as const
export const CONTENT_BLOCKS_ARTIFACT_NAME = 'content-blocks.json' as const
export const DECK_ARTIFACT_NAME = 'deck.json' as const
export const DECK_BRIEF_ARTIFACT_NAME = 'deck-brief.json' as const
export const DECK_COHERENCE_REPORT_ARTIFACT_NAME = 'deck-coherence-report.json' as const
export const DECK_COVERAGE_REPORT_ARTIFACT_NAME = 'deck-coverage-report.json' as const
export const DECK_QUALITY_REPORT_ARTIFACT_NAME = 'deck-quality-report.json' as const
export const DECK_TIMING_REPORT_ARTIFACT_NAME = 'deck-timing-report.json' as const
export const DECK_VOICEOVER_ARTIFACT_NAME = 'deck-voiceover.json' as const
export const DOCUMENT_ARTIFACT_NAME = 'document.json' as const
export const EXPORT_OUTPUT_ARTIFACT_NAME = 'export-output.json' as const
export const FRAMES_ARTIFACT_NAME = 'frames.json' as const
export const GLOBAL_OUTLINE_ARTIFACT_NAME = 'global-outline.json' as const
export const INGEST_REPORT_ARTIFACT_NAME = 'ingest-report.json' as const
export const MEDIA_INFO_ARTIFACT_NAME = 'media-info.json' as const
export const NARRATION_ARTIFACT_NAME = 'narration.json' as const
export const NARRATIVE_BEATS_ARTIFACT_NAME = 'narrative-beats.json' as const
export const OUTLINE_ARTIFACT_NAME = 'outline.json' as const
export const OUTPUT_NARRATION_ARTIFACT_NAME = 'output-narration.json' as const
export const OUTPUT_TIMELINE_MAP_ARTIFACT_NAME = 'output-timeline-map.json' as const
export const QUALITY_REPORT_ARTIFACT_NAME = 'quality-report.json' as const
export const RECAP_SCRIPT_ARTIFACT_NAME = 'recap-script.json' as const
export const RENDER_OUTPUT_ARTIFACT_NAME = 'render-output.json' as const
export const REVIEW_REPORT_ARTIFACT_NAME = 'review-report.json' as const
export const SCENE_ANALYSIS_ARTIFACT_NAME = 'scene-analysis.json' as const
export const SCENE_BATCHES_ARTIFACT_NAME = 'scene-batches.json' as const
export const SCENES_ARTIFACT_NAME = 'scenes.json' as const
export const SCRIPT_TIMING_REPORT_ARTIFACT_NAME = 'script-timing-report.json' as const
export const SELECTED_MOMENTS_ARTIFACT_NAME = 'selected-moments.json' as const
export const SILENCE_PERIODS_ARTIFACT_NAME = 'silence-periods.json' as const
export const SLIDE_OUTLINE_ARTIFACT_NAME = 'slide-outline.json' as const
export const SOURCE_MANIFEST_ARTIFACT_NAME = 'source-manifest.json' as const
export const SOURCE_MAP_ARTIFACT_NAME = 'source-map.json' as const
export const SOURCE_QUOTES_ARTIFACT_NAME = 'source-quotes.json' as const
export const SPEAKER_SCRIPT_ARTIFACT_NAME = 'speaker-script.json' as const
export const STORY_INDEX_ARTIFACT_NAME = 'story-index.json' as const
export const STORYBOARD_ARTIFACT_NAME = 'storyboard.json' as const
export const SUBTITLES_ARTIFACT_NAME = 'subtitles.json' as const
export const TIMELINE_ARTIFACT_NAME = 'timeline.json' as const
export const TIMELINE_FUSION_ARTIFACT_NAME = 'timeline-fusion.json' as const
export const TRANSCRIPT_ARTIFACT_NAME = 'transcript.json' as const
export const TTS_SEGMENTS_ARTIFACT_NAME = 'tts-segments.json' as const
export const VLM_ANALYSIS_ARTIFACT_NAME = 'vlm-analysis.json' as const
export const VOICEOVER_PLAN_ARTIFACT_NAME = 'voiceover-plan.json' as const

export const COMMON_PROJECT_JSON_ARTIFACT_NAMES = [
  ASR_RESULT_ARTIFACT_NAME,
  AUDIO_MIX_ARTIFACT_NAME,
  CHARACTER_INDEX_ARTIFACT_NAME,
  CHAPTERS_ARTIFACT_NAME,
  CHUNK_PLAN_ARTIFACT_NAME,
  CHUNK_SUMMARIES_ARTIFACT_NAME,
  CLAIMS_ARTIFACT_NAME,
  CLIP_PLAN_ARTIFACT_NAME,
  CLIP_PLAN_VALIDATED_ARTIFACT_NAME,
  CONTENT_ANALYSIS_ARTIFACT_NAME,
  CONTENT_BLOCKS_ARTIFACT_NAME,
  DECK_ARTIFACT_NAME,
  DECK_BRIEF_ARTIFACT_NAME,
  DECK_COHERENCE_REPORT_ARTIFACT_NAME,
  DECK_COVERAGE_REPORT_ARTIFACT_NAME,
  DECK_QUALITY_REPORT_ARTIFACT_NAME,
  DECK_TIMING_REPORT_ARTIFACT_NAME,
  DECK_VOICEOVER_ARTIFACT_NAME,
  DOCUMENT_ARTIFACT_NAME,
  EXPORT_OUTPUT_ARTIFACT_NAME,
  FRAMES_ARTIFACT_NAME,
  GLOBAL_OUTLINE_ARTIFACT_NAME,
  INGEST_REPORT_ARTIFACT_NAME,
  MEDIA_INFO_ARTIFACT_NAME,
  NARRATION_ARTIFACT_NAME,
  NARRATIVE_BEATS_ARTIFACT_NAME,
  OUTLINE_ARTIFACT_NAME,
  OUTPUT_NARRATION_ARTIFACT_NAME,
  OUTPUT_TIMELINE_MAP_ARTIFACT_NAME,
  QUALITY_REPORT_ARTIFACT_NAME,
  RECAP_SCRIPT_ARTIFACT_NAME,
  RENDER_OUTPUT_ARTIFACT_NAME,
  REVIEW_REPORT_ARTIFACT_NAME,
  SCENE_ANALYSIS_ARTIFACT_NAME,
  SCENE_BATCHES_ARTIFACT_NAME,
  SCENES_ARTIFACT_NAME,
  SCRIPT_TIMING_REPORT_ARTIFACT_NAME,
  SELECTED_MOMENTS_ARTIFACT_NAME,
  SILENCE_PERIODS_ARTIFACT_NAME,
  SLIDE_OUTLINE_ARTIFACT_NAME,
  SOURCE_MANIFEST_ARTIFACT_NAME,
  SOURCE_MAP_ARTIFACT_NAME,
  SOURCE_QUOTES_ARTIFACT_NAME,
  SPEAKER_SCRIPT_ARTIFACT_NAME,
  STORY_INDEX_ARTIFACT_NAME,
  STORYBOARD_ARTIFACT_NAME,
  SUBTITLES_ARTIFACT_NAME,
  TIMELINE_ARTIFACT_NAME,
  TIMELINE_FUSION_ARTIFACT_NAME,
  TRANSCRIPT_ARTIFACT_NAME,
  TTS_SEGMENTS_ARTIFACT_NAME,
  VLM_ANALYSIS_ARTIFACT_NAME,
  VOICEOVER_PLAN_ARTIFACT_NAME,
] as const

export type CommonProjectJsonArtifactName = (typeof COMMON_PROJECT_JSON_ARTIFACT_NAMES)[number]

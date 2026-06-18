import {z} from 'zod'

import {LongVideoTimeRangeSchema} from './long-video.js'
import {EvidenceSchema} from './storyboard.js'

export const SourceManifestSchema = z.object({
  audioTracks: z.number().int().nonnegative(),
  codecName: z.string().optional(),
  duration: z.number().finite().nonnegative(),
  fps: z.number().finite().positive().optional(),
  height: z.number().int().positive().optional(),
  orientation: z.enum(['landscape', 'portrait', 'square', 'unknown']),
  sourceHash: z.string().min(1),
  sourcePath: z.string().min(1),
  version: z.literal(1),
  width: z.number().int().positive().optional(),
})

export const FilmSceneSchema = z.object({
  id: z.string().min(1),
  sourceRange: LongVideoTimeRangeSchema,
  summary: z.string().optional(),
})

export const FilmScenesSchema = z.object({
  scenes: z.array(FilmSceneSchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const ASRSegmentSchema = z.object({
  confidence: z.number().finite().min(0).max(1).optional(),
  end: z.number().finite().nonnegative(),
  id: z.string().min(1),
  speaker: z.string().optional(),
  start: z.number().finite().nonnegative(),
  text: z.string().min(1),
  timestampConfidence: z.enum(['chunked', 'exact', 'untimed']).default('exact'),
}).refine((segment) => segment.end >= segment.start, {
  message: 'ASR segment end must be greater than or equal to start.',
  path: ['end'],
})

export const ASRResultSchema = z.object({
  language: z.string().default('unknown'),
  segments: z.array(ASRSegmentSchema),
  text: z.string(),
  timestampConfidence: z.enum(['chunked', 'exact', 'untimed']).default('untimed'),
  version: z.literal(1),
})

export const SilencePeriodSchema = z.object({
  end: z.number().finite().nonnegative(),
  id: z.string().min(1),
  reason: z.enum(['detected', 'no-audio', 'placeholder']).default('placeholder'),
  start: z.number().finite().nonnegative(),
}).refine((period) => period.end >= period.start, {
  message: 'Silence period end must be greater than or equal to start.',
  path: ['end'],
})

export const SilencePeriodsSchema = z.object({
  periods: z.array(SilencePeriodSchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const VLMSceneAnalysisSchema = z.object({
  actions: z.array(z.string().min(1)).default([]),
  characters: z.array(z.string().min(1)).default([]),
  emotions: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  id: z.string().min(1),
  plotClues: z.array(z.string().min(1)).default([]),
  relationships: z.array(z.string().min(1)).default([]),
  sceneId: z.string().min(1),
  sourceRange: LongVideoTimeRangeSchema,
  summary: z.string().min(1),
})

export const VLMAnalysisSchema = z.object({
  scenes: z.array(VLMSceneAnalysisSchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const TimelineFusionItemSchema = z.object({
  asrSegmentIds: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  id: z.string().min(1),
  sceneId: z.string().min(1),
  silencePeriodIds: z.array(z.string().min(1)).default([]),
  sourceRange: LongVideoTimeRangeSchema,
  summary: z.string().min(1),
  vlmAnalysisIds: z.array(z.string().min(1)).default([]),
})

export const TimelineFusionSchema = z.object({
  items: z.array(TimelineFusionItemSchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const CharacterIndexEntrySchema = z.object({
  aliases: z.array(z.string().min(1)).default([]),
  description: z.string().optional(),
  evidence: z.array(EvidenceSchema).default([]),
  id: z.string().min(1),
  name: z.string().min(1),
})

export const NarrativeBeatTypeSchema = z.enum([
  'setup',
  'inciting_incident',
  'conflict',
  'decision',
  'reversal',
  'climax',
  'resolution',
  'transition',
])

export const NarrativeBeatSchema = z.object({
  characters: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  id: z.string().min(1),
  sourceRange: LongVideoTimeRangeSchema,
  summary: z.string().min(1),
  type: NarrativeBeatTypeSchema,
})

export const StoryIndexSchema = z.object({
  beats: z.array(NarrativeBeatSchema),
  characters: z.array(CharacterIndexEntrySchema).default([]),
  language: z.string().default('zh-CN'),
  source: z.string().min(1),
  sourceDuration: z.number().finite().nonnegative(),
  version: z.literal(1),
})

export const RecapScriptSegmentSchema = z.object({
  emotionalTone: z.enum(['setup', 'tension', 'climax', 'resolution']),
  id: z.string().min(1),
  narrationText: z.string().min(1),
  suggestedDuration: z.number().finite().nonnegative(),
  targetBeatIds: z.array(z.string().min(1)).default([]),
  visualGuidance: z.string().min(1),
})

export const RecapScriptSchema = z.object({
  hook: z.string().min(1),
  language: z.string().default('zh-CN'),
  outro: z.string().min(1),
  segments: z.array(RecapScriptSegmentSchema),
  totalEstimatedDuration: z.number().finite().nonnegative(),
  version: z.literal(1),
})

export const NarrativeBeatsSchema = z.object({
  beats: z.array(NarrativeBeatSchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const CharacterIndexSchema = z.object({
  characters: z.array(CharacterIndexEntrySchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const OutputTimelineMapClipSchema = z.object({
  clipId: z.string().min(1),
  outputEnd: z.number().finite().nonnegative(),
  outputStart: z.number().finite().nonnegative(),
  sourceEnd: z.number().finite().nonnegative(),
  sourceStart: z.number().finite().nonnegative(),
}).superRefine((clip, ctx) => {
  if (clip.sourceEnd < clip.sourceStart) {
    ctx.addIssue({
      code: 'custom',
      message: 'Mapped clip sourceEnd must be greater than or equal to sourceStart.',
      path: ['sourceEnd'],
    })
  }

  if (clip.outputEnd < clip.outputStart) {
    ctx.addIssue({
      code: 'custom',
      message: 'Mapped clip outputEnd must be greater than or equal to outputStart.',
      path: ['outputEnd'],
    })
  }
})

export const OutputTimelineMapSchema = z.object({
  clips: z.array(OutputTimelineMapClipSchema),
  outputDuration: z.number().finite().nonnegative(),
  source: z.string().min(1),
  version: z.literal(1),
}).superRefine((map, ctx) => {
  map.clips.forEach((clip, index) => {
    if (clip.outputEnd > map.outputDuration) {
      ctx.addIssue({
        code: 'custom',
        message: 'Mapped clip output range must stay within outputDuration.',
        path: ['clips', index, 'outputEnd'],
      })
    }
  })
})

export const OutputNarrationSegmentSchema = z.object({
  end: z.number().finite().nonnegative(),
  evidence: z.array(z.string().min(1)).default([]),
  id: z.string().min(1),
  overlapsSpeech: z.boolean().default(false),
  pauseAfterMs: z.number().int().nonnegative().default(0),
  scriptSegmentId: z.string().min(1).optional(),
  source: z.literal('script'),
  start: z.number().finite().nonnegative(),
  text: z.string().min(1),
}).refine((segment) => segment.end >= segment.start, {
  message: 'Output narration segment end must be greater than or equal to start.',
  path: ['end'],
})

export const OutputNarrationSchema = z.object({
  language: z.string().default('zh-CN'),
  segments: z.array(OutputNarrationSegmentSchema),
  timeline: z.literal('output'),
  version: z.literal(1),
})

export type ASRSegment = z.infer<typeof ASRSegmentSchema>
export type ASRResult = z.infer<typeof ASRResultSchema>
export type CharacterIndex = z.infer<typeof CharacterIndexSchema>
export type CharacterIndexEntry = z.infer<typeof CharacterIndexEntrySchema>
export type FilmScene = z.infer<typeof FilmSceneSchema>
export type FilmScenes = z.infer<typeof FilmScenesSchema>
export type NarrativeBeat = z.infer<typeof NarrativeBeatSchema>
export type NarrativeBeats = z.infer<typeof NarrativeBeatsSchema>
export type NarrativeBeatType = z.infer<typeof NarrativeBeatTypeSchema>
export type OutputNarration = z.infer<typeof OutputNarrationSchema>
export type OutputNarrationSegment = z.infer<typeof OutputNarrationSegmentSchema>
export type OutputTimelineMap = z.infer<typeof OutputTimelineMapSchema>
export type OutputTimelineMapClip = z.infer<typeof OutputTimelineMapClipSchema>
export type RecapScript = z.infer<typeof RecapScriptSchema>
export type RecapScriptSegment = z.infer<typeof RecapScriptSegmentSchema>
export type SilencePeriod = z.infer<typeof SilencePeriodSchema>
export type SilencePeriods = z.infer<typeof SilencePeriodsSchema>
export type SourceManifest = z.infer<typeof SourceManifestSchema>
export type StoryIndex = z.infer<typeof StoryIndexSchema>
export type TimelineFusion = z.infer<typeof TimelineFusionSchema>
export type TimelineFusionItem = z.infer<typeof TimelineFusionItemSchema>
export type VLMAnalysis = z.infer<typeof VLMAnalysisSchema>
export type VLMSceneAnalysis = z.infer<typeof VLMSceneAnalysisSchema>

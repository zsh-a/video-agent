import {z} from 'zod'

import {LongVideoTimeRangeSchema} from './long-video.js'
import {EvidenceSchema} from './storyboard.js'

export const FilmSceneSchema = z.object({
  id: z.string().min(1),
  sourceRange: LongVideoTimeRangeSchema,
  summary: z.string().optional(),
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
export type CharacterIndexEntry = z.infer<typeof CharacterIndexEntrySchema>
export type FilmScene = z.infer<typeof FilmSceneSchema>
export type NarrativeBeat = z.infer<typeof NarrativeBeatSchema>
export type NarrativeBeatType = z.infer<typeof NarrativeBeatTypeSchema>
export type OutputNarration = z.infer<typeof OutputNarrationSchema>
export type OutputNarrationSegment = z.infer<typeof OutputNarrationSegmentSchema>
export type OutputTimelineMap = z.infer<typeof OutputTimelineMapSchema>
export type OutputTimelineMapClip = z.infer<typeof OutputTimelineMapClipSchema>
export type StoryIndex = z.infer<typeof StoryIndexSchema>
export type VLMSceneAnalysis = z.infer<typeof VLMSceneAnalysisSchema>

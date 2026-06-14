import {z} from 'zod'

export const TranscriptSegmentSchema = z.object({
  end: z.number().finite().nonnegative(),
  speaker: z.string().optional(),
  start: z.number().finite().nonnegative(),
  text: z.string(),
}).refine((segment) => segment.end >= segment.start, {
  message: 'Transcript segment end must be greater than or equal to start.',
  path: ['end'],
})

export const TranscriptSchema = z.object({
  language: z.string().optional(),
  segments: z.array(TranscriptSegmentSchema),
  text: z.string(),
})

export const VlmSceneSchema = z.object({
  description: z.string(),
  evidence: z.array(z.string()),
  sceneId: z.string().min(1),
})

export const VlmScenesSchema = z.array(VlmSceneSchema)

export const TtsSegmentSchema = z.object({
  duration: z.number().finite().nonnegative(),
  narrationId: z.string().min(1),
  path: z.string().min(1),
})

export const TtsSegmentsSchema = z.array(TtsSegmentSchema)

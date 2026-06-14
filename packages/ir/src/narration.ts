import {z} from 'zod'

export const NarrationSegmentSchema = z.object({
  duration: z.number().positive().optional(),
  id: z.string().min(1),
  sceneId: z.string().min(1).optional(),
  start: z.number().nonnegative().optional(),
  text: z.string().min(1),
  voice: z.string().optional(),
})

export const NarrationSchema = z.object({
  language: z.string().default('zh-CN'),
  segments: z.array(NarrationSegmentSchema),
  version: z.literal(1),
})

export type Narration = z.infer<typeof NarrationSchema>
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>

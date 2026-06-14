import {z} from 'zod'

export const TimelineTrackSchema = z.enum(['video', 'audio', 'voiceover', 'subtitle', 'overlay'])

export const TimelineItemSchema = z.object({
  duration: z.number().nonnegative(),
  id: z.string().min(1),
  source: z.string().optional(),
  sourceRange: z.tuple([z.number().nonnegative(), z.number().nonnegative()]).optional(),
  start: z.number().nonnegative(),
  track: TimelineTrackSchema,
})

export const TimelineSchema = z.object({
  duration: z.number().nonnegative(),
  fps: z.number().positive().default(30),
  items: z.array(TimelineItemSchema),
  version: z.literal(1),
})

export type Timeline = z.infer<typeof TimelineSchema>
export type TimelineItem = z.infer<typeof TimelineItemSchema>
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>

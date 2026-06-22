import {z} from 'zod'

export const TimelineTrackSchema = z.enum(['video', 'audio', 'voiceover', 'subtitle', 'overlay'])

export const TimelineItemSchema = z.object({
  duration: z.number().finite().positive({message: 'Timeline item duration must be greater than 0.'}),
  id: z.string().min(1),
  source: z.string().optional(),
  sourceRange: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]).optional(),
  start: z.number().finite().nonnegative(),
  track: TimelineTrackSchema,
}).refine((item) => item.sourceRange === undefined || item.sourceRange[1] > item.sourceRange[0], {
  message: 'Timeline item sourceRange end must be greater than start.',
  path: ['sourceRange'],
})

export const TimelineSchema = z.object({
  duration: z.number().finite().nonnegative(),
  fps: z.number().finite().positive().default(30),
  items: z.array(TimelineItemSchema),
  version: z.literal(1),
}).superRefine((timeline, ctx) => {
  timeline.items.forEach((item, index) => {
    if (item.start + item.duration > timeline.duration + 0.001) {
      ctx.addIssue({
        code: 'custom',
        message: 'Timeline item must not end after the timeline duration.',
        path: ['items', index, 'duration'],
      })
    }
  })
})

export type Timeline = z.infer<typeof TimelineSchema>
export type TimelineItem = z.infer<typeof TimelineItemSchema>
export type TimelineTrack = z.infer<typeof TimelineTrackSchema>

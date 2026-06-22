import {z} from 'zod'

export const MotionTargetSchema = z.object({
  kind: z.enum(['css-selector', 'semantic']),
  value: z.string().min(1),
})

export const MotionPropertySchema = z.enum([
  'blur',
  'opacity',
  'scale',
  'scaleX',
  'rotate',
  'translateX',
  'translateY',
])

export const MotionEasingSchema = z.enum([
  'easeOutCubic',
  'easeOutExpo',
  'linear',
])

export const MotionTrackSchema = z.object({
  duration: z.number().finite().positive(),
  easing: MotionEasingSchema.default('easeOutCubic'),
  from: z.number().finite(),
  id: z.string().min(1),
  property: MotionPropertySchema,
  stagger: z.number().finite().nonnegative().optional(),
  start: z.number().finite().nonnegative(),
  target: MotionTargetSchema,
  to: z.number().finite(),
})

export const MotionSceneSchema = z.object({
  end: z.number().finite().nonnegative(),
  id: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  start: z.number().finite().nonnegative(),
}).refine((scene) => scene.end > scene.start, {
  message: 'Motion scene end must be greater than start.',
  path: ['end'],
})

export const MotionTimelineSchema = z.object({
  duration: z.number().finite().nonnegative(),
  fps: z.number().finite().positive().default(30),
  scenes: z.array(MotionSceneSchema).default([]),
  tracks: z.array(MotionTrackSchema).default([]),
  version: z.literal(1),
}).superRefine((timeline, ctx) => {
  timeline.scenes.forEach((scene, index) => {
    if (scene.end > timeline.duration + 0.001) {
      ctx.addIssue({
        code: 'custom',
        message: 'Motion scene must not end after the timeline duration.',
        path: ['scenes', index, 'end'],
      })
    }
  })

  timeline.tracks.forEach((track, index) => {
    if (track.start + track.duration > timeline.duration + 0.001) {
      ctx.addIssue({
        code: 'custom',
        message: 'Motion track must not end after the timeline duration.',
        path: ['tracks', index, 'duration'],
      })
    }
  })
})

export type MotionEasing = z.infer<typeof MotionEasingSchema>
export type MotionProperty = z.infer<typeof MotionPropertySchema>
export type MotionScene = z.infer<typeof MotionSceneSchema>
export type MotionTarget = z.infer<typeof MotionTargetSchema>
export type MotionTimeline = z.infer<typeof MotionTimelineSchema>
export type MotionTrack = z.infer<typeof MotionTrackSchema>

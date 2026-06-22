import {z} from 'zod'

export const ClipPlanItemSchema = z.object({
  beatId: z.string().min(1).optional(),
  duration: z.number().positive(),
  id: z.string().min(1),
  priorityScore: z.number().nonnegative().optional(),
  reason: z.string().optional(),
  scriptSegmentId: z.string().min(1).optional(),
  sceneId: z.string().min(1),
  selectionReason: z.string().min(1).optional(),
  selectionRank: z.number().int().positive().optional(),
  source: z.string().min(1),
  sourceRange: z.tuple([z.number().nonnegative(), z.number().nonnegative()]),
  start: z.number().nonnegative(),
}).refine((clip) => clip.sourceRange[1] > clip.sourceRange[0], {
  message: 'Clip sourceRange end must be greater than start.',
  path: ['sourceRange'],
})

export const ClipPlanSchema = z.object({
  clips: z.array(ClipPlanItemSchema),
  duration: z.number().positive(),
  source: z.string().min(1),
  sourceDuration: z.number().nonnegative(),
  version: z.literal(1),
})

export type ClipPlan = z.infer<typeof ClipPlanSchema>
export type ClipPlanItem = z.infer<typeof ClipPlanItemSchema>

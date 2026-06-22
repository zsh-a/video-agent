import {z} from 'zod'

export const EVIDENCE_TYPES = ['asr', 'vlm', 'ocr', 'research'] as const

export const STORYBOARD_TARGET_PLATFORMS = ['douyin', 'kuaishou', 'bilibili', 'youtube', 'xhs', 'generic'] as const

export const EvidenceSchema = z.object({
  ref: z.string().min(1),
  text: z.string().optional(),
  type: z.enum(EVIDENCE_TYPES),
})

const StoryboardRangeSchema = z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()])

export const StoryboardSceneSchema = z.object({
  duration: z.number().positive(),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  narration: z.string().optional(),
  outputRange: StoryboardRangeSchema.optional(),
  sourceRange: StoryboardRangeSchema.optional(),
  start: z.number().nonnegative(),
  visualStyle: z.string().min(1),
}).refine((scene) => scene.outputRange === undefined || scene.outputRange[1] > scene.outputRange[0], {
  message: 'Storyboard scene outputRange end must be greater than start.',
  path: ['outputRange'],
}).refine((scene) => scene.sourceRange === undefined || scene.sourceRange[1] > scene.sourceRange[0], {
  message: 'Storyboard scene sourceRange end must be greater than start.',
  path: ['sourceRange'],
})

export const StoryboardSchema = z.object({
  language: z.string().min(1),
  scenes: z.array(StoryboardSceneSchema),
  targetPlatform: z.enum(STORYBOARD_TARGET_PLATFORMS),
  version: z.literal(1),
})

export type Evidence = z.infer<typeof EvidenceSchema>
export type Storyboard = z.infer<typeof StoryboardSchema>
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>

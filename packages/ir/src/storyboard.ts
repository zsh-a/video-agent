import {z} from 'zod'

export const EvidenceSchema = z.object({
  ref: z.string().min(1),
  text: z.string().optional(),
  type: z.enum(['asr', 'vlm', 'ocr', 'research']),
})

export const StoryboardSceneSchema = z.object({
  duration: z.number().positive(),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  narration: z.string().optional(),
  outputRange: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]).optional(),
  sourceRange: z.tuple([z.number().finite().nonnegative(), z.number().finite().nonnegative()]).optional(),
  start: z.number().nonnegative(),
  visualStyle: z.string().min(1),
}).refine((scene) => scene.outputRange === undefined || scene.outputRange[1] >= scene.outputRange[0], {
  message: 'Storyboard scene outputRange end must be greater than or equal to start.',
  path: ['outputRange'],
}).refine((scene) => scene.sourceRange === undefined || scene.sourceRange[1] >= scene.sourceRange[0], {
  message: 'Storyboard scene sourceRange end must be greater than or equal to start.',
  path: ['sourceRange'],
})

export const StoryboardSchema = z.object({
  language: z.string().min(1),
  scenes: z.array(StoryboardSceneSchema),
  targetPlatform: z.enum(['douyin', 'kuaishou', 'bilibili', 'youtube', 'xhs', 'generic']),
  version: z.literal(1),
})

export type Evidence = z.infer<typeof EvidenceSchema>
export type Storyboard = z.infer<typeof StoryboardSchema>
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>

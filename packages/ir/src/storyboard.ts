import {z} from 'zod'

export const EvidenceSchema = z.object({
  ref: z.string().min(1),
  text: z.string().optional(),
  type: z.enum(['asr', 'vlm', 'ocr', 'research']),
})

export const StoryboardSceneSchema = z.object({
  duration: z.number().positive(),
  evidence: z.array(EvidenceSchema).default([]),
  id: z.string().min(1),
  narration: z.string().optional(),
  start: z.number().nonnegative(),
  visualStyle: z.string().default('documentary'),
})

export const StoryboardSchema = z.object({
  language: z.string().default('zh-CN'),
  scenes: z.array(StoryboardSceneSchema),
  targetPlatform: z.enum(['douyin', 'kuaishou', 'bilibili', 'youtube', 'xhs', 'generic']).default('generic'),
  version: z.literal(1),
})

export type Evidence = z.infer<typeof EvidenceSchema>
export type Storyboard = z.infer<typeof StoryboardSchema>
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>

import {z} from 'zod'

import {EvidenceSchema} from './storyboard.js'

export const LongVideoTimeRangeSchema = z.tuple([
  z.number().finite().nonnegative(),
  z.number().finite().nonnegative(),
]).refine(([start, end]) => end >= start, {
  message: 'Time range end must be greater than or equal to start.',
})

export const LongVideoChunkPlanDefaultsSchema = z.object({
  asrChunking: z.boolean(),
  chunkDuration: z.number().finite().positive(),
  chunkOverlap: z.number().finite().nonnegative(),
  frameSampleFps: z.number().finite().positive(),
  sceneDetection: z.boolean(),
  vlmBatchSize: z.number().int().positive(),
  vlmFrameSampleFps: z.number().finite().positive(),
})

export const LongVideoChunkSchema = z.object({
  analysisRange: LongVideoTimeRangeSchema,
  artifactPrefix: z.string().min(1),
  contentRange: LongVideoTimeRangeSchema,
  duration: z.number().finite().nonnegative(),
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
}).superRefine((chunk, ctx) => {
  if (chunk.analysisRange[0] > chunk.contentRange[0]) {
    ctx.addIssue({
      code: 'custom',
      message: 'Chunk analysisRange must start before or at contentRange start.',
      path: ['analysisRange'],
    })
  }

  if (chunk.analysisRange[1] < chunk.contentRange[1]) {
    ctx.addIssue({
      code: 'custom',
      message: 'Chunk analysisRange must end after or at contentRange end.',
      path: ['analysisRange'],
    })
  }

  if (Math.abs(chunk.duration - (chunk.contentRange[1] - chunk.contentRange[0])) > 0.001) {
    ctx.addIssue({
      code: 'custom',
      message: 'Chunk duration must match contentRange length.',
      path: ['duration'],
    })
  }
})

export const LongVideoChunkPlanSchema = z.object({
  chunks: z.array(LongVideoChunkSchema),
  defaults: LongVideoChunkPlanDefaultsSchema,
  source: z.string().min(1),
  sourceDuration: z.number().finite().nonnegative(),
  version: z.literal(1),
}).superRefine((plan, ctx) => {
  plan.chunks.forEach((chunk, index) => {
    if (chunk.index !== index) {
      ctx.addIssue({
        code: 'custom',
        message: 'Chunk indexes must match array order.',
        path: ['chunks', index, 'index'],
      })
    }

    if (chunk.contentRange[1] > plan.sourceDuration || chunk.analysisRange[1] > plan.sourceDuration) {
      ctx.addIssue({
        code: 'custom',
        message: 'Chunk ranges must stay within sourceDuration.',
        path: ['chunks', index],
      })
    }
  })
})

export const LongVideoAnalysisFrameSchema = z.object({
  path: z.string().min(1),
  timestamp: z.number().finite().nonnegative(),
})

export const LongVideoAnalysisFramesSchema = z.object({
  frameCount: z.number().int().nonnegative(),
  framePattern: z.string().min(1),
  frames: z.array(LongVideoAnalysisFrameSchema),
  sampleFps: z.number().finite().positive(),
  source: z.string().min(1),
  version: z.literal(1),
}).superRefine((manifest, ctx) => {
  if (manifest.frameCount !== manifest.frames.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'frameCount must match frames length.',
      path: ['frameCount'],
    })
  }
})

export const LongVideoMomentSchema = z.object({
  chunkId: z.string().min(1).optional(),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  outputRange: LongVideoTimeRangeSchema.optional(),
  score: z.number().finite().min(0).max(1).optional(),
  sourceRange: LongVideoTimeRangeSchema,
  summary: z.string().min(1),
  title: z.string().min(1).optional(),
})

export const LongVideoChunkSummarySchema = z.object({
  chunkId: z.string().min(1),
  contentRange: LongVideoTimeRangeSchema,
  keyMoments: z.array(LongVideoMomentSchema),
  silenceRanges: z.array(LongVideoTimeRangeSchema),
  summary: z.string().min(1),
  transcriptSummary: z.string().optional(),
  visualSummary: z.string().optional(),
})

export const LongVideoChunkSilenceSchema = z.object({
  chunkId: z.string().min(1),
  contentRange: LongVideoTimeRangeSchema,
  silenceRanges: z.array(LongVideoTimeRangeSchema),
  version: z.literal(1),
})

export const LongVideoChunkSummariesSchema = z.object({
  chunks: z.array(LongVideoChunkSummarySchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const LongVideoChapterSummarySchema = z.object({
  chunkIds: z.array(z.string().min(1)),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  index: z.number().int().nonnegative(),
  keyMoments: z.array(LongVideoMomentSchema),
  sourceRange: LongVideoTimeRangeSchema,
  summary: z.string().min(1),
  title: z.string().min(1),
})

export const LongVideoChapterSummariesSchema = z.object({
  chapters: z.array(LongVideoChapterSummarySchema),
  source: z.string().min(1),
  version: z.literal(1),
})

export const LongVideoStoryBeatSchema = z.object({
  chapterIds: z.array(z.string().min(1)),
  evidence: z.array(EvidenceSchema),
  id: z.string().min(1),
  sourceRange: LongVideoTimeRangeSchema.optional(),
  summary: z.string().min(1),
  title: z.string().min(1),
})

export const LongVideoGlobalOutlineSchema = z.object({
  chapters: z.array(LongVideoChapterSummarySchema),
  language: z.string().min(1),
  source: z.string().min(1),
  sourceDuration: z.number().finite().nonnegative(),
  storyBeats: z.array(LongVideoStoryBeatSchema),
  targetDuration: z.number().finite().positive().optional(),
  version: z.literal(1),
})

export const LongVideoSelectedMomentSchema = LongVideoMomentSchema.extend({
  chunkId: z.string().min(1),
  reason: z.string().min(1),
})

export const LongVideoSelectedMomentsSchema = z.object({
  moments: z.array(LongVideoSelectedMomentSchema),
  source: z.string().min(1),
  targetDuration: z.number().finite().positive().optional(),
  version: z.literal(1),
})

export type LongVideoAnalysisFrame = z.infer<typeof LongVideoAnalysisFrameSchema>
export type LongVideoAnalysisFrames = z.infer<typeof LongVideoAnalysisFramesSchema>
export type LongVideoChapterSummaries = z.infer<typeof LongVideoChapterSummariesSchema>
export type LongVideoChapterSummary = z.infer<typeof LongVideoChapterSummarySchema>
export type LongVideoChunk = z.infer<typeof LongVideoChunkSchema>
export type LongVideoChunkPlan = z.infer<typeof LongVideoChunkPlanSchema>
export type LongVideoChunkPlanDefaults = z.infer<typeof LongVideoChunkPlanDefaultsSchema>
export type LongVideoChunkSilence = z.infer<typeof LongVideoChunkSilenceSchema>
export type LongVideoChunkSummaries = z.infer<typeof LongVideoChunkSummariesSchema>
export type LongVideoChunkSummary = z.infer<typeof LongVideoChunkSummarySchema>
export type LongVideoGlobalOutline = z.infer<typeof LongVideoGlobalOutlineSchema>
export type LongVideoMoment = z.infer<typeof LongVideoMomentSchema>
export type LongVideoSelectedMoment = z.infer<typeof LongVideoSelectedMomentSchema>
export type LongVideoSelectedMoments = z.infer<typeof LongVideoSelectedMomentsSchema>
export type LongVideoStoryBeat = z.infer<typeof LongVideoStoryBeatSchema>
export type LongVideoTimeRange = z.infer<typeof LongVideoTimeRangeSchema>

import {z} from 'zod'

export const MediaStreamTypeSchema = z.enum(['audio', 'data', 'subtitle', 'unknown', 'video'])

export const MediaStreamSchema = z.object({
  codecName: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  fps: z.number().positive().optional(),
  height: z.number().int().positive().optional(),
  index: z.number().int().nonnegative(),
  type: MediaStreamTypeSchema,
  width: z.number().int().positive().optional(),
})

export const MediaInfoSchema = z.object({
  bitrate: z.number().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
  formatName: z.string().optional(),
  inputPath: z.string().min(1),
  probedAt: z.string().datetime(),
  size: z.number().nonnegative().optional(),
  streams: z.array(MediaStreamSchema),
  version: z.literal(1),
})

export type MediaInfo = z.infer<typeof MediaInfoSchema>
export type MediaStream = z.infer<typeof MediaStreamSchema>
export type MediaStreamType = z.infer<typeof MediaStreamTypeSchema>

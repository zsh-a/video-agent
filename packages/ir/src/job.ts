import {z} from 'zod'

export const ArtifactRefSchema = z.object({
  kind: z.enum(['json', 'video', 'audio', 'image', 'subtitle', 'directory', 'other']),
  path: z.string().min(1),
  sha256: z.string().optional(),
})

export const JobStatusSchema = z.enum(['queued', 'running', 'needs-review', 'failed', 'completed', 'canceled'])

export const StageNameSchema = z.enum([
  'ingest',
  'understand',
  'plan',
  'script',
  'voiceover',
  'render',
  'quality',
  'export',
])

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>
export type JobStatus = z.infer<typeof JobStatusSchema>
export type StageName = z.infer<typeof StageNameSchema>

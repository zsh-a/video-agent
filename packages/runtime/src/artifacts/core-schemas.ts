import {z} from 'zod'

export const IngestReportSchema = z.object({
  artifacts: z.record(z.string(), z.string().min(1)),
  completedAt: z.string().min(1),
  inputPath: z.string().min(1),
  stage: z.literal('ingest'),
  version: z.literal(1),
}).strict()

export const QualityReportSchema = z.object({
  checkedAt: z.string().min(1).optional(),
  issues: z.array(z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(['error', 'warning']),
  }).passthrough()),
  narrationSegments: z.number().int().nonnegative().optional(),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }).strict(),
  ttsSegments: z.number().int().nonnegative().optional(),
  version: z.literal(1),
}).passthrough()

export const IssueCountSchema = z.object({
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
}).passthrough()

export const RenderOutputSchema = z.object({
  audioInputs: z.number().int().nonnegative().optional(),
  audioQuality: IssueCountSchema.optional(),
  completedAt: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  outputQuality: IssueCountSchema.optional(),
  renderer: z.enum(['ffmpeg', 'html', 'remotion']),
  subtitleQuality: IssueCountSchema.optional(),
  templateQuality: IssueCountSchema.optional(),
  version: z.literal(1),
  visualQuality: IssueCountSchema.optional(),
}).passthrough()

export const ExportOutputSchema = z.object({
  cleanOutput: z.boolean(),
  completedAt: z.string().min(1),
  format: z.enum(['bundle', 'video']),
  outputPath: z.string().min(1),
  requireQuality: z.boolean(),
  sourcePath: z.string().min(1),
  version: z.literal(1),
}).passthrough()

export const VoiceoverPlanSchema = z.object({
  generatedAt: z.string().min(1),
  segments: z.array(z.object({
    alignment: z.enum(['explicit-start', 'narration-id', 'narration-index', 'sequential']),
    duration: z.number().nonnegative().optional(),
    index: z.number().int().nonnegative(),
    narrationId: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    resolvedPath: z.string().min(1).optional(),
    start: z.number().nonnegative(),
    status: z.enum(['available', 'invalid-path', 'missing']),
  }).strict()),
  version: z.literal(1),
}).strict()

export const AudioMixSchema = z.object({
  duration: z.number().nonnegative(),
  ducking: z.object({
    attackMs: z.number().nonnegative(),
    ratio: z.number().nonnegative(),
    releaseMs: z.number().nonnegative(),
    threshold: z.number().nonnegative(),
  }).strict().optional(),
  generatedAt: z.string().min(1),
  loudnessNormalization: z.object({
    loudnessRangeLufs: z.number(),
    targetIntegratedLufs: z.number(),
    truePeakDb: z.number(),
  }).strict(),
  mode: z.enum(['silence', 'source-ducked', 'source-only', 'voiceover-only']),
  outputPath: z.string().min(1),
  sourceAudioRetained: z.boolean(),
  sourcePath: z.string().min(1),
  sourceVolume: z.number().nonnegative(),
  sourceVolumeDuringVoiceover: z.number().nonnegative().optional(),
  version: z.literal(1),
  voiceoverVolume: z.number().nonnegative(),
  voiceoverSegments: z.array(z.object({
    delayMs: z.number().int().nonnegative(),
    duration: z.number().nonnegative(),
    narrationId: z.string().min(1),
    path: z.string().min(1),
    resolvedPath: z.string().min(1),
    start: z.number().nonnegative(),
  }).strict()),
}).strict()

export const SubtitleOutputSchema = z.object({
  cues: z.number().int().nonnegative(),
  format: z.literal('srt'),
  generatedAt: z.string().min(1),
  path: z.string().min(1),
  version: z.literal(1),
}).strict()

export const RenderOutputReferenceSchema = z.object({
  audioPath: z.string().min(1).optional(),
  audioMixPath: z.string().min(1).optional(),
  entryHtml: z.string().min(1).optional(),
  frameManifestPath: z.string().min(1).optional(),
  keyframeQualityPath: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  planPath: z.string().min(1).optional(),
  rendered: z.object({
    command: z.array(z.string()),
  }).passthrough().optional(),
  runtimePath: z.string().min(1).optional(),
  reviewHtmlPath: z.string().min(1).optional(),
  reviewReportPath: z.string().min(1).optional(),
  subtitlePath: z.string().min(1).optional(),
  silentVideoPath: z.string().min(1).optional(),
  stylesPath: z.string().min(1).optional(),
  visualQuality: z.object({
    frameSample: z.object({
      path: z.string().min(1).optional(),
    }).passthrough().optional(),
    frameSamples: z.array(z.object({
      path: z.string().min(1).optional(),
    }).passthrough()).optional(),
  }).passthrough().optional(),
  voiceoverPlanPath: z.string().min(1).optional(),
}).passthrough()

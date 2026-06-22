import {z} from 'zod'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY, QualityIssueSeveritySchema} from '@video-agent/ir'

import {EXPORT_FORMATS} from '../render/export-format.js'
import {RENDER_OUTPUT_RENDERERS} from '../render/output-renderers.js'
import {MISSING_VOICEOVER_REASON, VOICEOVER_ALIGNMENTS, VOICEOVER_SEGMENT_STATUSES} from '../render/voiceover-plan.js'

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
    severity: QualityIssueSeveritySchema,
  }).passthrough()),
  narrationSegments: z.number().int().nonnegative().optional(),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
  }).strict(),
  ttsSegments: z.number().int().nonnegative().optional(),
  version: z.literal(1),
}).passthrough().superRefine((report, ctx) => {
  const errors = report.issues.filter((issue) => issue.severity === QUALITY_ERROR_SEVERITY).length
  const warnings = report.issues.filter((issue) => issue.severity === QUALITY_WARNING_SEVERITY).length

  if (report.summary.errors !== errors) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Quality report summary.errors must equal the number of error issues (${errors}).`,
      path: ['summary', 'errors'],
    })
  }

  if (report.summary.warnings !== warnings) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Quality report summary.warnings must equal the number of warning issues (${warnings}).`,
      path: ['summary', 'warnings'],
    })
  }
})

export const IssueCountSchema = z.object({
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
}).passthrough()

export const VisualFrameSampleSchema = z.object({
  capturedAt: z.string().min(1),
  error: z.string().min(1).optional(),
  ok: z.boolean(),
  path: z.string().min(1),
  sha256: z.string().min(1).optional(),
  size: z.number().int().nonnegative().optional(),
  timestamp: z.number().nonnegative(),
}).strict()

export const VisualQualitySchema = IssueCountSchema.extend({
  frameSamples: z.array(VisualFrameSampleSchema).optional(),
}).passthrough()

export const VoiceoverPlanSegmentSchema = z.object({
  alignment: z.enum(VOICEOVER_ALIGNMENTS),
  duration: z.number().positive(),
  index: z.number().int().nonnegative(),
  narrationId: z.string().min(1),
  path: z.string().min(1),
  resolvedPath: z.string().min(1).optional(),
  start: z.number().nonnegative(),
  status: z.enum(VOICEOVER_SEGMENT_STATUSES),
}).strict()

export const VoiceoverPlanSchema = z.object({
  generatedAt: z.string().min(1),
  segments: z.array(VoiceoverPlanSegmentSchema),
  version: z.literal(1),
}).strict()

export const MissingVoiceoverDiagnosticSchema = z.object({
  index: z.number().int().nonnegative(),
  narrationId: z.string().min(1),
  path: z.string().min(1),
  reason: z.literal(MISSING_VOICEOVER_REASON),
  resolvedPath: z.string().min(1).optional(),
}).strict()

export const RenderAudioDiagnosticsSchema = z.object({
  availableVoiceovers: z.number().int().nonnegative(),
  missingVoiceovers: z.array(MissingVoiceoverDiagnosticSchema),
  plan: VoiceoverPlanSchema,
  sourceAudioPath: z.string().min(1).optional(),
  warnings: z.array(z.string().min(1)),
}).strict()

export const RenderOutputSchema = z.object({
  audioDiagnostics: RenderAudioDiagnosticsSchema.optional(),
  audioInputs: z.number().int().nonnegative().optional(),
  audioMixPath: z.string().min(1).optional(),
  audioPath: z.string().min(1).optional(),
  audioQuality: IssueCountSchema.optional(),
  completedAt: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  outputQuality: IssueCountSchema.optional(),
  renderer: z.enum(RENDER_OUTPUT_RENDERERS),
  reviewHtmlPath: z.string().min(1).optional(),
  reviewReportPath: z.string().min(1).optional(),
  silentVideoPath: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
  subtitleQuality: IssueCountSchema.optional(),
  subtitlePath: z.string().min(1).optional(),
  templateQuality: IssueCountSchema.optional(),
  version: z.literal(1),
  visualQuality: VisualQualitySchema.optional(),
  voiceoverPlanPath: z.string().min(1).optional(),
}).passthrough()

export const ExportOutputSchema = z.object({
  cleanOutput: z.boolean(),
  completedAt: z.string().min(1),
  format: z.enum(EXPORT_FORMATS),
  outputPath: z.string().min(1),
  requireQuality: z.boolean(),
  sourcePath: z.string().min(1),
  version: z.literal(1),
}).passthrough()

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
    frameSamples: z.array(z.object({
      path: z.string().min(1).optional(),
    }).passthrough()).optional(),
  }).passthrough().optional(),
  voiceoverPlanPath: z.string().min(1).optional(),
}).passthrough()

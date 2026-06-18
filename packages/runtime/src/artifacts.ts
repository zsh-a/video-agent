import {z, type ZodType} from 'zod'

import {ASRResultSchema, ArtifactRefSchema, CharacterIndexSchema, ClaimsSchema, ClipPlanSchema, ContentBlocksSchema, DeckQualityReportSchema, DeckSchema, DocumentSchema, FilmScenesSchema, LongVideoAnalysisFramesSchema, LongVideoChapterSummariesSchema, LongVideoChunkPlanSchema, LongVideoChunkSilenceSchema, LongVideoChunkSummariesSchema, LongVideoChunkSummarySchema, LongVideoGlobalOutlineSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, NarrationSchema, NarrativeBeatsSchema, OutlineSchema, OutputNarrationSchema, OutputTimelineMapSchema, RecapScriptSchema, SilencePeriodsSchema, SourceManifestSchema, SourceQuotesSchema, SpeakerScriptSchema, StoryIndexSchema, StoryboardSchema, TimedDeckSchema, TimelineFusionSchema, TimelineSchema, VLMAnalysisSchema} from '@video-agent/ir'
import {SceneFrameBatchesSchema, TranscriptSchema, TtsSegmentsSchema, VlmScenesSchema} from '@video-agent/providers'
import {createHash} from 'node:crypto'
import {readdir, stat} from 'node:fs/promises'
import {extname, isAbsolute, join, relative, resolve, sep} from 'node:path'

import type {ArtifactManifest} from './artifact-store.js'

import {ARTIFACT_MANIFEST_NAME} from './artifact-store.js'
import {bunFile} from './bun-runtime.js'
import {readOptionalJson} from './file-io.js'

export interface ProjectArtifact {
  kind: 'json' | 'log' | 'other'
  name: string
  path: string
  sha256?: string
  size: number
  updatedAt: string
}

export interface ReadProjectArtifactResult {
  artifact: ProjectArtifact
  content: unknown
}

export interface ArtifactIntegrityChangedIssue {
  actualSha256: string
  actualSize: number
  expectedSha256: string
  expectedSize: number
  name: string
}

export interface ArtifactIntegrityMissingIssue {
  name: string
  reason: 'missing'
}

export interface ArtifactSchemaInvalidIssue {
  issues: ArtifactSchemaIssue[]
  name: string
}

export interface ArtifactSchemaIssue {
  code: string
  message: string
  path: string[]
}

export interface ArtifactIntegrityResult {
  changed: ArtifactIntegrityChangedIssue[]
  checked: number
  manifestPath: string
  missing: ArtifactIntegrityMissingIssue[]
  ok: boolean
  schemaInvalid: ArtifactSchemaInvalidIssue[]
  summary: ArtifactIntegritySummary
  untracked: string[]
}

export interface ArtifactIntegritySummary {
  changed: number
  checked: number
  errors: number
  missing: number
  schemaInvalid: number
  untracked: number
  warnings: number
}

const IngestReportSchema = z.object({
  artifacts: z.record(z.string(), z.string().min(1)),
  completedAt: z.string().min(1),
  inputPath: z.string().min(1),
  stage: z.literal('ingest'),
  version: z.literal(1),
}).strict()

const QualityReportSchema = z.object({
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

const IssueCountSchema = z.object({
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
}).passthrough()

const RenderOutputSchema = z.object({
  audioInputs: z.number().int().nonnegative().optional(),
  audioQuality: IssueCountSchema.optional(),
  completedAt: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  outputQuality: IssueCountSchema.optional(),
  renderer: z.enum(['ffmpeg', 'html', 'hyperframes']),
  subtitleQuality: IssueCountSchema.optional(),
  templateQuality: IssueCountSchema.optional(),
  version: z.literal(1),
  visualQuality: IssueCountSchema.optional(),
}).passthrough()

const ExportOutputSchema = z.object({
  cleanOutput: z.boolean(),
  completedAt: z.string().min(1),
  format: z.enum(['bundle', 'hyperframes', 'video']),
  outputPath: z.string().min(1),
  requireQuality: z.boolean(),
  sourcePath: z.string().min(1),
  version: z.literal(1),
}).passthrough()

const VoiceoverPlanSchema = z.object({
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

const AudioMixSchema = z.object({
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

const SubtitleOutputSchema = z.object({
  cues: z.number().int().nonnegative(),
  format: z.literal('srt'),
  generatedAt: z.string().min(1),
  path: z.string().min(1),
  version: z.literal(1),
}).strict()

const DeckVoiceoverSchema = z.object({
  duration: z.number().nonnegative(),
  generatedAt: z.string().min(1),
  outputPath: z.string().min(1),
  segments: z.array(z.object({
    duration: z.number().nonnegative(),
    narrationId: z.string().min(1),
    path: z.string().min(1),
    slideId: z.string().min(1),
    start: z.number().nonnegative(),
  }).strict()),
  version: z.literal(1),
}).strict()

const RenderOutputReferenceSchema = z.object({
  audioPath: z.string().min(1).optional(),
  audioMixPath: z.string().min(1).optional(),
  entryHtml: z.string().min(1).optional(),
  outputDir: z.string().min(1).optional(),
  outputPath: z.string().min(1).optional(),
  planPath: z.string().min(1).optional(),
  rendered: z.object({
    command: z.array(z.string()),
  }).passthrough().optional(),
  runtimePath: z.string().min(1).optional(),
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

const PipelineEventLogLineSchema = z.object({
  artifact: ArtifactRefSchema.optional(),
  attempt: z.number().int().positive().optional(),
  current: z.number().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  level: z.enum(['debug', 'error', 'info', 'warn']).optional(),
  maxAttempts: z.number().int().positive().optional(),
  message: z.string().min(1).optional(),
  percent: z.number().nonnegative().optional(),
  projectId: z.string().min(1),
  retryDelayMs: z.number().nonnegative().optional(),
  stage: z.string().min(1).optional(),
  step: z.string().min(1).optional(),
  time: z.string().min(1),
  total: z.number().nonnegative().optional(),
  type: z.enum(['artifact', 'log', 'stage:complete', 'stage:fail', 'stage:progress', 'stage:retry', 'stage:start']),
  unit: z.enum(['chunks', 'files', 'frames', 'scenes', 'seconds', 'segments', 'tokens']).optional(),
}).passthrough()

const ProviderCostMetadataSchema = z.object({
  amount: z.number(),
  currency: z.string().min(1),
  estimated: z.boolean().optional(),
}).passthrough()

const ProviderUsageMetadataSchema = z.object({
  audioSeconds: z.number().nonnegative().optional(),
  inputCharacters: z.number().nonnegative().optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputCharacters: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
}).passthrough()

const ProviderCallLogLineSchema = z.object({
  completedAt: z.string().min(1),
  cost: ProviderCostMetadataSchema.optional(),
  durationMs: z.number().nonnegative(),
  error: z.object({
    message: z.string().min(1),
    name: z.string().min(1),
  }).strict().optional(),
  input: z.record(z.string(), z.unknown()),
  model: z.string().min(1).optional(),
  operation: z.string().min(1),
  output: z.record(z.string(), z.unknown()).optional(),
  provider: z.string().min(1),
  requestId: z.string().min(1),
  role: z.enum(['asr', 'script', 'tts', 'vlm']),
  startedAt: z.string().min(1),
  status: z.enum(['failed', 'succeeded']),
  usage: ProviderUsageMetadataSchema.optional(),
  version: z.literal(1),
}).passthrough().superRefine((value, ctx) => {
  if (value.status === 'failed' && value.error === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Failed provider calls must include an error.',
      path: ['error'],
    })
  }
})

const LLMUsageSchema = z.object({
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative().optional(),
}).passthrough()

const LLMTraceLogLineSchema = z.object({
  completedAt: z.string().min(1),
  durationMs: z.number().nonnegative(),
  error: z.object({
    message: z.string().min(1),
    name: z.string().min(1),
  }).strict().optional(),
  model: z.string().min(1).optional(),
  operation: z.enum(['generateObject', 'generateObjectFallbackText', 'generateText', 'streamText']),
  provider: z.string().min(1).optional(),
  request: z.object({
    messages: z.array(z.unknown()).optional(),
    prompt: z.string().optional(),
    providerOptions: z.record(z.string(), z.unknown()).optional(),
    schema: z.unknown().optional(),
    temperature: z.number().optional(),
  }).passthrough(),
  requestId: z.string().min(1),
  response: z.object({
    object: z.unknown().optional(),
    text: z.string().optional(),
  }).passthrough().optional(),
  startedAt: z.string().min(1),
  status: z.enum(['failed', 'succeeded']),
  usage: LLMUsageSchema.optional(),
  version: z.literal(1),
}).passthrough().superRefine((value, ctx) => {
  if (value.status === 'failed' && value.error === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Failed LLM traces must include an error.',
      path: ['error'],
    })
  }
})

const ARTIFACT_SCHEMAS: Record<string, ZodType> = {
  'audio-mix.json': AudioMixSchema,
  'asr-result.json': ASRResultSchema,
  'character-index.json': CharacterIndexSchema,
  'chapters.json': LongVideoChapterSummariesSchema,
  'chunk-plan.json': LongVideoChunkPlanSchema,
  'chunk-summaries.json': LongVideoChunkSummariesSchema,
  'claims.json': ClaimsSchema,
  'clip-plan.json': ClipPlanSchema,
  'clip-plan-validated.json': ClipPlanSchema,
  'content-blocks.json': ContentBlocksSchema,
  'deck-voiceover.json': DeckVoiceoverSchema,
  'deck-quality-report.json': DeckQualityReportSchema,
  'deck.json': DeckSchema,
  'document.json': DocumentSchema,
  'export-output.json': ExportOutputSchema,
  'frames.json': LongVideoAnalysisFramesSchema,
  'global-outline.json': LongVideoGlobalOutlineSchema,
  'ingest-report.json': IngestReportSchema,
  'media-info.json': MediaInfoSchema,
  'narration.json': NarrationSchema,
  'outline.json': OutlineSchema,
  'output-narration.json': OutputNarrationSchema,
  'output-timeline-map.json': OutputTimelineMapSchema,
  'quality-report.json': QualityReportSchema,
  'recap-script.json': RecapScriptSchema,
  'render-output.json': RenderOutputSchema,
  'scene-analysis.json': VlmScenesSchema,
  'scene-batches.json': SceneFrameBatchesSchema,
  'scenes.json': FilmScenesSchema,
  'selected-moments.json': LongVideoSelectedMomentsSchema,
  'silence-periods.json': SilencePeriodsSchema,
  'speaker-script.json': SpeakerScriptSchema,
  'source-manifest.json': SourceManifestSchema,
  'source-quotes.json': SourceQuotesSchema,
  'story-index.json': StoryIndexSchema,
  'storyboard.json': StoryboardSchema,
  'subtitles.json': SubtitleOutputSchema,
  'narrative-beats.json': NarrativeBeatsSchema,
  'timed-deck.json': TimedDeckSchema,
  'timeline-fusion.json': TimelineFusionSchema,
  'timeline.json': TimelineSchema,
  'transcript.json': TranscriptSchema,
  'tts-segments.json': TtsSegmentsSchema,
  'vlm-analysis.json': VLMAnalysisSchema,
  'voiceover-plan.json': VoiceoverPlanSchema,
}

const NESTED_ARTIFACT_SCHEMAS: Array<{pattern: RegExp; schema: ZodType}> = [
  {pattern: /^chunks\/[^/]+\/summary\.json$/, schema: LongVideoChunkSummarySchema},
  {pattern: /^chunks\/[^/]+\/silence\.json$/, schema: LongVideoChunkSilenceSchema},
  {pattern: /^chunks\/[^/]+\/transcript\.json$/, schema: TranscriptSchema},
  {pattern: /^chunks\/[^/]+\/vlm\.json$/, schema: VlmScenesSchema},
]

const ARTIFACT_JSONL_SCHEMAS: Record<string, ZodType> = {
  'llm-traces.jsonl': LLMTraceLogLineSchema,
  'pipeline-events.jsonl': PipelineEventLogLineSchema,
  'provider-calls.jsonl': ProviderCallLogLineSchema,
}

export async function listProjectArtifacts(projectId: string, workspaceDir = '.video-agent'): Promise<ProjectArtifact[]> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const manifest = await readArtifactManifest(artifactsDir)
  const entries = await collectArtifactFiles(artifactsDir, artifactsDir)
  const artifacts = await Promise.all(
    entries
      .map(async (entry) => {
        const path = resolve(artifactsDir, entry.name)
        const metadata = await stat(path)
        const manifestEntry = manifest?.artifacts.find((artifact) => artifact.name === entry.name)

        return {
          kind: inferArtifactKind(entry.name),
          name: entry.name,
          path,
          ...(manifestEntry?.sha256 === undefined ? {} : {sha256: manifestEntry.sha256}),
          size: metadata.size,
          updatedAt: metadata.mtime.toISOString(),
        }
      }),
  )

  return artifacts.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readProjectArtifact(projectId: string, artifactName: string, workspaceDir = '.video-agent'): Promise<ReadProjectArtifactResult> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const path = resolve(artifactsDir, artifactName)

  if (!path.startsWith(`${artifactsDir}/`)) {
    throw new Error(`Invalid artifact path: ${artifactName}`)
  }

  const metadata = await stat(path)
  const manifest = await readArtifactManifest(artifactsDir)
  const manifestEntry = manifest?.artifacts.find((item) => item.name === artifactName)
  const artifact = {
    kind: inferArtifactKind(artifactName),
    name: artifactName,
    path,
    ...(manifestEntry?.sha256 === undefined ? {} : {sha256: manifestEntry.sha256}),
    size: metadata.size,
    updatedAt: metadata.mtime.toISOString(),
  }
  const text = await bunFile(path).text()
  const content = artifact.kind === 'json' ? JSON.parse(text) : text

  return {
    artifact,
    content,
  }
}

export async function readProjectArtifactManifest(projectId: string, workspaceDir = '.video-agent'): Promise<ArtifactManifest | undefined> {
  return readArtifactManifest(resolve(workspaceDir, 'projects', projectId, 'artifacts'))
}

export async function verifyProjectArtifacts(projectId: string, workspaceDir = '.video-agent'): Promise<ArtifactIntegrityResult> {
  const artifactsDir = resolve(workspaceDir, 'projects', projectId, 'artifacts')
  const manifestPath = resolve(artifactsDir, ARTIFACT_MANIFEST_NAME)
  const manifest = await readArtifactManifest(artifactsDir)

  if (manifest === undefined) {
    const missing = [{name: ARTIFACT_MANIFEST_NAME, reason: 'missing'}] satisfies ArtifactIntegrityMissingIssue[]

    return {
      changed: [],
      checked: 0,
      manifestPath,
      missing,
      ok: false,
      schemaInvalid: [],
      summary: summarizeArtifactIntegrity({
        changed: [],
        checked: 0,
        missing,
        schemaInvalid: [],
        untracked: [],
      }),
      untracked: [],
    }
  }

  const changed: ArtifactIntegrityChangedIssue[] = []
  const missing: ArtifactIntegrityMissingIssue[] = []
  const schemaInvalid: ArtifactSchemaInvalidIssue[] = []
  const manifestNames = new Set(manifest.artifacts.map((artifact) => artifact.name))

  await Promise.all(manifest.artifacts.map(async (artifact) => {
    const path = resolve(artifactsDir, artifact.name)

    try {
      const [content, metadata] = await Promise.all([bunFile(path).bytes(), stat(path)])
      const sha256 = createHash('sha256').update(content).digest('hex')
      const schemaIssue = validateKnownArtifactSchema(artifact.name, content)

      if (sha256 !== artifact.sha256 || metadata.size !== artifact.size) {
        changed.push({
          actualSha256: sha256,
          actualSize: metadata.size,
          expectedSha256: artifact.sha256,
          expectedSize: artifact.size,
          name: artifact.name,
        })
      }

      if (schemaIssue !== undefined) {
        schemaInvalid.push(schemaIssue)
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        missing.push({name: artifact.name, reason: 'missing'})
        return
      }

      throw error
    }
  }))

  missing.push(...await findMissingIngestSideArtifactReferences(artifactsDir))
  missing.push(...await findMissingAnalysisFrameReferences(artifactsDir))
  missing.push(...await findMissingAudioMixReferences(artifactsDir))
  missing.push(...await findMissingDeckVoiceoverReferences(artifactsDir))
  missing.push(...await findMissingSubtitleOutputReferences(artifactsDir))
  missing.push(...await findMissingTimedDeckReferences(artifactsDir))
  missing.push(...await findMissingTtsSegmentReferences(artifactsDir))
  missing.push(...await findMissingRenderOutputReferences(artifactsDir))
  missing.push(...await findMissingExportOutputReferences(artifactsDir))

  const entries = await collectArtifactFiles(artifactsDir, artifactsDir)
  const untracked = entries
    .filter((entry) => entry.name !== ARTIFACT_MANIFEST_NAME && !manifestNames.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const sortedChanged = changed.sort((a, b) => a.name.localeCompare(b.name))
  const sortedMissing = missing.sort((a, b) => a.name.localeCompare(b.name))
  const sortedSchemaInvalid = schemaInvalid.sort((a, b) => a.name.localeCompare(b.name))

  return {
    changed: sortedChanged,
    checked: manifest.artifacts.length,
    manifestPath,
    missing: sortedMissing,
    ok: changed.length === 0 && missing.length === 0 && schemaInvalid.length === 0 && untracked.length === 0,
    schemaInvalid: sortedSchemaInvalid,
    summary: summarizeArtifactIntegrity({
      changed: sortedChanged,
      checked: manifest.artifacts.length,
      missing: sortedMissing,
      schemaInvalid: sortedSchemaInvalid,
      untracked,
    }),
    untracked,
  }
}

async function findMissingTimedDeckReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const timedDeck = TimedDeckSchema.parse(await bunFile(resolve(artifactsDir, 'timed-deck.json')).json())
    const projectDir = resolve(artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths([timedDeck.audioRef]))
  } catch {
    return []
  }
}

async function findMissingDeckVoiceoverReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const deckVoiceover = DeckVoiceoverSchema.parse(await bunFile(resolve(artifactsDir, 'deck-voiceover.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const paths = uniquePaths([
      deckVoiceover.outputPath,
      ...deckVoiceover.segments.map((segment) => segment.path),
    ])

    return findMissingProjectPathReferences(projectDir, paths)
  } catch {
    return []
  }
}

async function findMissingSubtitleOutputReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const subtitles = SubtitleOutputSchema.parse(await bunFile(resolve(artifactsDir, 'subtitles.json')).json())
    const projectDir = resolve(artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths([subtitles.path]))
  } catch {
    return []
  }
}

async function findMissingAudioMixReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const audioMix = AudioMixSchema.parse(await bunFile(resolve(artifactsDir, 'audio-mix.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const paths = uniquePaths([
      audioMix.outputPath,
      audioMix.sourcePath,
      ...audioMix.voiceoverSegments.flatMap((segment) => [segment.path, segment.resolvedPath]),
    ])

    return findMissingProjectPathReferences(projectDir, paths)
  } catch {
    return []
  }
}

async function findMissingAnalysisFrameReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const manifest = LongVideoAnalysisFramesSchema.parse(await bunFile(resolve(artifactsDir, 'frames.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const missing = await Promise.all(manifest.frames.map(async (frame) => {
      const exists = await bunFile(frame.path).exists()

      return exists ? null : {name: relative(projectDir, frame.path).split(sep).join('/'), reason: 'missing' as const}
    }))

    return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
  } catch {
    return []
  }
}

async function findMissingIngestSideArtifactReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const report = IngestReportSchema.parse(await bunFile(resolve(artifactsDir, 'ingest-report.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const paths = [
      report.artifacts?.preview,
      report.artifacts?.sourceAudio,
    ].filter((path): path is string => typeof path === 'string' && path.length > 0)
    const missing = await Promise.all(paths.map(async (path) => {
      const resolvedPath = resolveProjectPath(projectDir, path)
      const exists = await bunFile(resolvedPath).exists()

      return exists ? null : {name: relative(projectDir, resolvedPath).split(sep).join('/'), reason: 'missing' as const}
    }))

    return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
  } catch {
    return []
  }
}

async function findMissingTtsSegmentReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const segments = TtsSegmentsSchema.parse(await bunFile(resolve(artifactsDir, 'tts-segments.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const missing = await Promise.all(segments.map(async (segment) => {
      const resolvedPath = resolveProjectPath(projectDir, segment.path)
      const exists = await bunFile(resolvedPath).exists()

      return exists ? null : {name: relative(projectDir, resolvedPath).split(sep).join('/'), reason: 'missing' as const}
    }))

    return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
  } catch {
    return []
  }
}

async function findMissingRenderOutputReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const value = await bunFile(resolve(artifactsDir, 'render-output.json')).json()

    RenderOutputSchema.parse(value)

    const renderOutput = RenderOutputReferenceSchema.parse(value)
    const projectDir = resolve(artifactsDir, '..')
    const paths = uniquePaths([
      renderOutput.outputPath,
      renderOutput.audioPath,
      renderOutput.audioMixPath,
      renderOutput.subtitlePath,
      renderOutput.silentVideoPath,
      renderOutput.voiceoverPlanPath,
      renderOutput.outputDir,
      renderOutput.entryHtml,
      renderOutput.planPath,
      renderOutput.runtimePath,
      renderOutput.stylesPath,
      extractHyperframesRenderOutputPath(renderOutput.rendered?.command),
      renderOutput.visualQuality?.frameSample?.path,
      ...(renderOutput.visualQuality?.frameSamples ?? []).map((sample) => sample.path),
    ])

    return findMissingProjectPathReferences(projectDir, paths)
  } catch {
    return []
  }
}

async function findMissingExportOutputReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const exportOutput = ExportOutputSchema.parse(await bunFile(resolve(artifactsDir, 'export-output.json')).json())
    const projectDir = resolve(artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths([exportOutput.outputPath, exportOutput.sourcePath]))
  } catch {
    return []
  }
}

async function findMissingProjectPathReferences(projectDir: string, paths: string[]): Promise<ArtifactIntegrityMissingIssue[]> {
  const missing = await Promise.all(paths.map(async (path) => {
    const resolvedPath = resolveProjectPath(projectDir, path)
    const exists = await pathExists(resolvedPath)

    return exists ? null : {name: toProjectReferenceName(projectDir, resolvedPath), reason: 'missing' as const}
  }))

  return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)

    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

function uniquePaths(paths: Array<string | undefined>): string[] {
  return [...new Set(paths.filter((path): path is string => typeof path === 'string' && path.length > 0))]
}

function extractHyperframesRenderOutputPath(command: string[] | undefined): string | undefined {
  const outputFlagIndex = command?.lastIndexOf('--output') ?? -1

  return outputFlagIndex < 0 ? undefined : command?.[outputFlagIndex + 1]
}

function resolveProjectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path)
}

function toProjectReferenceName(projectDir: string, path: string): string {
  const name = relative(projectDir, path)

  if (name !== '' && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)) {
    return name.split(sep).join('/')
  }

  return path
}

function summarizeArtifactIntegrity(result: {
  changed: ArtifactIntegrityChangedIssue[]
  checked: number
  missing: ArtifactIntegrityMissingIssue[]
  schemaInvalid: ArtifactSchemaInvalidIssue[]
  untracked: string[]
}): ArtifactIntegritySummary {
  const errors = result.changed.length + result.missing.length + result.schemaInvalid.length
  const warnings = result.untracked.length

  return {
    changed: result.changed.length,
    checked: result.checked,
    errors,
    missing: result.missing.length,
    schemaInvalid: result.schemaInvalid.length,
    untracked: result.untracked.length,
    warnings,
  }
}

async function readArtifactManifest(artifactsDir: string): Promise<ArtifactManifest | undefined> {
  return readOptionalJson<ArtifactManifest>(resolve(artifactsDir, ARTIFACT_MANIFEST_NAME))
}

function inferArtifactKind(name: string): ProjectArtifact['kind'] {
  if (extname(name) === '.json') {
    return 'json'
  }

  if (extname(name) === '.jsonl' || extname(name) === '.log') {
    return 'log'
  }

  return 'other'
}

function validateKnownArtifactSchema(name: string, content: Uint8Array): ArtifactSchemaInvalidIssue | undefined {
  const schema = findArtifactSchema(name)

  if (schema !== undefined) {
    return validateJsonArtifactSchema(name, content, schema)
  }

  const jsonlSchema = ARTIFACT_JSONL_SCHEMAS[name]

  return jsonlSchema === undefined ? undefined : validateJsonlArtifactSchema(name, content, jsonlSchema)
}

function validateJsonArtifactSchema(name: string, content: Uint8Array, schema: ZodType): ArtifactSchemaInvalidIssue | undefined {
  let value: unknown

  try {
    value = JSON.parse(new TextDecoder().decode(content))
  } catch (error) {
    return {
      issues: [{
        code: 'invalid_json',
        message: error instanceof Error ? error.message : 'Invalid JSON',
        path: [],
      }],
      name,
    }
  }

  const result = schema.safeParse(value)

  if (result.success) {
    return undefined
  }

  return {
    issues: result.error.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path.map(String),
    })),
    name,
  }
}

function validateJsonlArtifactSchema(name: string, content: Uint8Array, schema: ZodType): ArtifactSchemaInvalidIssue | undefined {
  const issues: ArtifactSchemaIssue[] = []
  const lines = new TextDecoder().decode(content).split('\n')

  lines.forEach((line, index) => {
    const lineNumber = String(index + 1)

    if (line.trim().length === 0) {
      return
    }

    let value: unknown

    try {
      value = JSON.parse(line)
    } catch (error) {
      issues.push({
        code: 'invalid_json',
        message: error instanceof Error ? error.message : 'Invalid JSON',
        path: [lineNumber],
      })
      return
    }

    const result = schema.safeParse(value)

    if (!result.success) {
      issues.push(...result.error.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        path: [lineNumber, ...issue.path.map(String)],
      })))
    }
  })

  return issues.length === 0 ? undefined : {issues, name}
}

async function collectArtifactFiles(rootDir: string, currentDir: string): Promise<Array<{name: string; path: string}>> {
  const entries = await readdir(currentDir, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async (entry): Promise<Array<{name: string; path: string}>> => {
    const path = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      return collectArtifactFiles(rootDir, path)
    }

    if (!entry.isFile()) {
      return []
    }

    return [{
      name: toArtifactName(rootDir, path),
      path,
    }]
  }))

  return nested.flat()
}

function findArtifactSchema(name: string): ZodType | undefined {
  return ARTIFACT_SCHEMAS[name] ?? NESTED_ARTIFACT_SCHEMAS.find((item) => item.pattern.test(name))?.schema
}

function toArtifactName(rootDir: string, path: string): string {
  return relative(rootDir, path).split(sep).join('/')
}

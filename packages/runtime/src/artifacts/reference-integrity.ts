import type {ArtifactIntegrityMissingIssue} from './index.js'
import type {ZodType} from 'zod'

import {FilmAudioMixSchema, FilmSubtitleOutputSchema, LongVideoAnalysisFramesSchema, TimedDeckSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {stat} from 'node:fs/promises'
import {isAbsolute, relative, resolve, sep} from 'node:path'

import {collectArtifactFiles} from './files.js'
import {AUDIO_MIX_ARTIFACT_NAME, DECK_VOICEOVER_ARTIFACT_NAME, EXPORT_OUTPUT_ARTIFACT_NAME, FRAMES_ARTIFACT_NAME, INGEST_REPORT_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME, REVIEW_REPORT_ARTIFACT_NAME, SUBTITLES_ARTIFACT_NAME, TTS_SEGMENTS_ARTIFACT_NAME} from './artifact-names.js'
import {ExportOutputSchema, IngestReportSchema, RenderOutputReferenceSchema, RenderOutputSchema} from './core-schemas.js'
import {DeckFrameManifestSchema, DeckFrameShardBatchSchema, DeckFrameShardSchema, DeckKeyframesSchema, DeckRendererBackendProjectSchema, DeckRendererRemotionOutputSchema, DeckReviewReportSchema, DeckVoiceoverSchema} from './deck-schemas.js'
import {DECK_FRAME_MANIFEST_ARTIFACT_NAME, DECK_FRAME_SHARD_BATCH_ARTIFACT_NAME, DECK_KEYFRAMES_ARTIFACT_NAME, DECK_RENDERER_BACKEND_ARTIFACT_NAMES, DECK_RENDERER_REMOTION_OUTPUT_ARTIFACT_NAME, TIMED_DECK_ARTIFACT_NAME} from './deck-artifact-constants.js'
import {readOptionalJson} from '../shared/file-io.js'

const DECK_RENDERER_BACKEND_ARTIFACT_NAME_SET = new Set<string>(DECK_RENDERER_BACKEND_ARTIFACT_NAMES)

interface ReferenceIntegrityOptions {
  skipArtifacts?: ReadonlySet<string>
  trackedArtifacts?: ReadonlySet<string>
}

interface ReferenceReaderContext {
  artifactsDir: string
  skipArtifacts: ReadonlySet<string>
  trackedArtifacts: ReadonlySet<string>
}

export async function findMissingArtifactReferences(artifactsDir: string, options: ReferenceIntegrityOptions = {}): Promise<ArtifactIntegrityMissingIssue[]> {
  const context: ReferenceReaderContext = {
    artifactsDir,
    skipArtifacts: options.skipArtifacts ?? new Set(),
    trackedArtifacts: options.trackedArtifacts ?? new Set(),
  }
  const missing = await Promise.all([
    findMissingIngestSideArtifactReferences(context),
    findMissingAnalysisFrameReferences(context),
    findMissingAudioMixReferences(context),
    findMissingDeckFrameManifestReferences(context),
    findMissingDeckFrameShardBatchReferences(context),
    findMissingDeckFrameShardReferences(context),
    findMissingDeckRendererBackendReferences(context),
    findMissingDeckRendererRemotionOutputReferences(context),
    findMissingDeckKeyframeReferences(context),
    findMissingDeckReviewReportReferences(context),
    findMissingDeckVoiceoverReferences(context),
    findMissingSubtitleOutputReferences(context),
    findMissingTimedDeckReferences(context),
    findMissingTtsSegmentReferences(context),
    findMissingRenderOutputReferences(context),
    findMissingExportOutputReferences(context),
  ])

  return missing.flat()
}

async function findMissingTimedDeckReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const timedDeck = await readOptionalReferenceArtifact(context, TIMED_DECK_ARTIFACT_NAME, TimedDeckSchema)

  if (timedDeck === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')

  return findMissingProjectPathReferences(projectDir, uniquePaths([timedDeck.audioRef]))
}

async function findMissingDeckVoiceoverReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const deckVoiceover = await readOptionalReferenceArtifact(context, DECK_VOICEOVER_ARTIFACT_NAME, DeckVoiceoverSchema)

  if (deckVoiceover === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')
  const paths = uniquePaths([
    deckVoiceover.outputPath,
    ...deckVoiceover.segments.map((segment) => segment.path),
  ])

  return findMissingProjectPathReferences(projectDir, paths)
}

async function findMissingDeckFrameManifestReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const manifest = await readOptionalReferenceArtifact(context, DECK_FRAME_MANIFEST_ARTIFACT_NAME, DeckFrameManifestSchema)

  if (manifest === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')
  const paths = uniquePaths([
    manifest.outputDir,
    ...manifest.frames.map((frame) => frame.path),
  ])

  return findMissingProjectPathReferences(projectDir, paths)
}

async function findMissingDeckFrameShardReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const entries = await collectArtifactFiles(context.artifactsDir, context.artifactsDir)
  const shardNames = entries.map((entry) => entry.name).filter((name) => context.trackedArtifacts.has(name) && /^deck-frame-shard-\d{6}-\d{6}\.json$/.test(name))
  const nested = await Promise.all(shardNames.map(async (name) => {
    const shard = await readOptionalReferenceArtifact(context, name, DeckFrameShardSchema)

    if (shard === undefined) {
      return []
    }

    const projectDir = resolve(context.artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths([
      shard.outputDir,
      ...shard.frames.map((frame) => frame.path),
    ]))
  }))

  return nested.flat()
}

async function findMissingDeckFrameShardBatchReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const batch = await readOptionalReferenceArtifact(context, DECK_FRAME_SHARD_BATCH_ARTIFACT_NAME, DeckFrameShardBatchSchema)

  if (batch === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')

  return findMissingProjectPathReferences(projectDir, uniquePaths([
    batch.frameManifestPath,
    batch.htmlOutputDir,
    batch.outputDir,
    ...batch.shards.flatMap((shard) => shard.artifactPath === undefined ? [] : [shard.artifactPath]),
  ]))
}

async function findMissingDeckRendererBackendReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const entries = await collectArtifactFiles(context.artifactsDir, context.artifactsDir)
  const artifactNames = entries.map((entry) => entry.name).filter((name) => context.trackedArtifacts.has(name) && DECK_RENDERER_BACKEND_ARTIFACT_NAME_SET.has(name))
  const nested = await Promise.all(artifactNames.map(async (name) => {
    const artifact = await readOptionalReferenceArtifact(context, name, DeckRendererBackendProjectSchema)

    if (artifact === undefined) {
      return []
    }

    const projectDir = resolve(context.artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths([
      artifact.commandCwd,
      artifact.outputDir,
      artifact.motionTimelinePath,
      ...Object.values(artifact.files),
    ]))
  }))

  return nested.flat()
}

async function findMissingDeckRendererRemotionOutputReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const output = await readOptionalReferenceArtifact(context, DECK_RENDERER_REMOTION_OUTPUT_ARTIFACT_NAME, DeckRendererRemotionOutputSchema)

  if (output === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')

  return findMissingProjectPathReferences(projectDir, uniquePaths([
    output.commandCwd,
    output.exportArtifactPath,
    output.outputPath,
    output.rendererProjectDir,
  ]))
}

async function findMissingDeckKeyframeReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const keyframes = await readOptionalReferenceArtifact(context, DECK_KEYFRAMES_ARTIFACT_NAME, DeckKeyframesSchema)

  if (keyframes === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')

  return findMissingProjectPathReferences(projectDir, uniquePaths(keyframes.samples.map((sample) => sample.path)))
}

async function findMissingDeckReviewReportReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const report = await readOptionalReferenceArtifact(context, REVIEW_REPORT_ARTIFACT_NAME, DeckReviewReportSchema)

  if (report === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')
  const paths = uniquePaths([
    report.keyframeQualityPath,
    report.outputPath,
    report.reviewHtmlPath,
    ...report.slides.map((slide) => slide.keyframe?.path),
  ])

  return findMissingProjectPathReferences(projectDir, paths)
}

async function findMissingSubtitleOutputReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const subtitles = await readOptionalReferenceArtifact(context, SUBTITLES_ARTIFACT_NAME, FilmSubtitleOutputSchema)

  if (subtitles === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')

  return findMissingProjectPathReferences(projectDir, uniquePaths([subtitles.path]))
}

async function findMissingAudioMixReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const audioMix = await readOptionalReferenceArtifact(context, AUDIO_MIX_ARTIFACT_NAME, FilmAudioMixSchema)

  if (audioMix === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')
  const paths = uniquePaths([
    audioMix.outputPath,
    audioMix.sourcePath,
    ...audioMix.voiceoverSegments.flatMap((segment) => [segment.path, segment.resolvedPath]),
  ])

  return findMissingProjectPathReferences(projectDir, paths)
}

async function findMissingAnalysisFrameReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const manifest = await readOptionalReferenceArtifact(context, FRAMES_ARTIFACT_NAME, LongVideoAnalysisFramesSchema)

  if (manifest === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')
  const missing = await Promise.all(manifest.frames.map(async (frame) => {
    const exists = await pathExists(frame.path)

    return exists ? null : {name: relative(projectDir, frame.path).split(sep).join('/'), reason: 'missing' as const}
  }))

  return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
}

async function findMissingIngestSideArtifactReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const report = await readOptionalReferenceArtifact(context, INGEST_REPORT_ARTIFACT_NAME, IngestReportSchema)

  if (report === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')
  const paths = [
    report.artifacts?.preview,
    report.artifacts?.sourceAudio,
  ].filter((path): path is string => typeof path === 'string' && path.length > 0)
  const missing = await Promise.all(paths.map(async (path) => {
    const resolvedPath = resolveProjectPath(projectDir, path)
    const exists = await pathExists(resolvedPath)

    return exists ? null : {name: relative(projectDir, resolvedPath).split(sep).join('/'), reason: 'missing' as const}
  }))

  return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
}

async function findMissingTtsSegmentReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const segments = await readOptionalReferenceArtifact(context, TTS_SEGMENTS_ARTIFACT_NAME, TtsSegmentsSchema)

  if (segments === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')
  const missing = await Promise.all(segments.map(async (segment) => {
    const resolvedPath = resolveProjectPath(projectDir, segment.path)
    const exists = await pathExists(resolvedPath)

    return exists ? null : {name: relative(projectDir, resolvedPath).split(sep).join('/'), reason: 'missing' as const}
  }))

  return missing.filter((issue): issue is ArtifactIntegrityMissingIssue => issue !== null)
}

async function findMissingRenderOutputReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const renderOutput = await readOptionalReferenceArtifact(context, RENDER_OUTPUT_ARTIFACT_NAME, RenderOutputSchema)

  if (renderOutput === undefined) {
    return []
  }

  const referenceResult = RenderOutputReferenceSchema.safeParse(renderOutput)

  if (!referenceResult.success) {
    return []
  }

  const references = referenceResult.data
  const projectDir = resolve(context.artifactsDir, '..')
  const paths = uniquePaths([
    references.outputPath,
    references.reviewHtmlPath,
    references.reviewReportPath,
    references.audioPath,
    references.audioMixPath,
    references.frameManifestPath,
    references.keyframeQualityPath,
    references.subtitlePath,
    references.silentVideoPath,
    references.voiceoverPlanPath,
    references.outputDir,
    references.entryHtml,
    references.planPath,
    references.runtimePath,
    references.stylesPath,
    extractHyperframesRenderOutputPath(references.rendered?.command),
    ...(references.visualQuality?.frameSamples ?? []).map((sample) => sample.path),
  ])

  return findMissingProjectPathReferences(projectDir, paths)
}

async function findMissingExportOutputReferences(context: ReferenceReaderContext): Promise<ArtifactIntegrityMissingIssue[]> {
  const exportOutput = await readOptionalReferenceArtifact(context, EXPORT_OUTPUT_ARTIFACT_NAME, ExportOutputSchema)

  if (exportOutput === undefined) {
    return []
  }

  const projectDir = resolve(context.artifactsDir, '..')

  return findMissingProjectPathReferences(projectDir, uniquePaths([exportOutput.outputPath, exportOutput.sourcePath]))
}

async function readOptionalReferenceArtifact<T>(context: ReferenceReaderContext, name: string, schema: ZodType<T>): Promise<T | undefined> {
  if (!context.trackedArtifacts.has(name)) {
    return undefined
  }

  if (context.skipArtifacts.has(name)) {
    return undefined
  }

  const value = await readOptionalJson(resolve(context.artifactsDir, name))

  if (value === undefined) {
    return undefined
  }

  return schema.parse(value)
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

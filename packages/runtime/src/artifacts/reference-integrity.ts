import type {ArtifactIntegrityMissingIssue} from './index.js'

import {LongVideoAnalysisFramesSchema, TimedDeckSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {stat} from 'node:fs/promises'
import {isAbsolute, relative, resolve, sep} from 'node:path'

import {collectArtifactFiles} from './files.js'
import {AudioMixSchema, DeckFrameManifestSchema, DeckFrameShardBatchSchema, DeckFrameShardSchema, DeckKeyframesSchema, DeckRendererBackendProjectSchema, DeckRendererRemotionOutputSchema, DeckReviewReportSchema, DeckVoiceoverSchema, ExportOutputSchema, IngestReportSchema, RenderOutputReferenceSchema, RenderOutputSchema, SubtitleOutputSchema} from './schemas.js'
import {bunFile} from '../shared/bun-runtime.js'

export async function findMissingArtifactReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  const missing = await Promise.all([
    findMissingIngestSideArtifactReferences(artifactsDir),
    findMissingAnalysisFrameReferences(artifactsDir),
    findMissingAudioMixReferences(artifactsDir),
    findMissingDeckFrameManifestReferences(artifactsDir),
    findMissingDeckFrameShardBatchReferences(artifactsDir),
    findMissingDeckFrameShardReferences(artifactsDir),
    findMissingDeckRendererBackendReferences(artifactsDir),
    findMissingDeckRendererRemotionOutputReferences(artifactsDir),
    findMissingDeckKeyframeReferences(artifactsDir),
    findMissingDeckReviewReportReferences(artifactsDir),
    findMissingDeckVoiceoverReferences(artifactsDir),
    findMissingSubtitleOutputReferences(artifactsDir),
    findMissingTimedDeckReferences(artifactsDir),
    findMissingTtsSegmentReferences(artifactsDir),
    findMissingRenderOutputReferences(artifactsDir),
    findMissingExportOutputReferences(artifactsDir),
  ])

  return missing.flat()
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

async function findMissingDeckFrameManifestReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const manifest = DeckFrameManifestSchema.parse(await bunFile(resolve(artifactsDir, 'deck-frame-manifest.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const paths = uniquePaths([
      manifest.outputDir,
      ...manifest.frames.map((frame) => frame.path),
    ])

    return findMissingProjectPathReferences(projectDir, paths)
  } catch {
    return []
  }
}

async function findMissingDeckFrameShardReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const entries = await collectArtifactFiles(artifactsDir, artifactsDir)
    const shardNames = entries.map((entry) => entry.name).filter((name) => /^deck-frame-shard-\d{6}-\d{6}\.json$/.test(name))
    const nested = await Promise.all(shardNames.map(async (name) => {
      const shard = DeckFrameShardSchema.parse(await bunFile(resolve(artifactsDir, name)).json())
      const projectDir = resolve(artifactsDir, '..')

      return findMissingProjectPathReferences(projectDir, uniquePaths([
        shard.outputDir,
        ...shard.frames.map((frame) => frame.path),
      ]))
    }))

    return nested.flat()
  } catch {
    return []
  }
}

async function findMissingDeckFrameShardBatchReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const batch = DeckFrameShardBatchSchema.parse(await bunFile(resolve(artifactsDir, 'deck-frame-shard-batch.json')).json())
    const projectDir = resolve(artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths([
      batch.frameManifestPath,
      batch.htmlOutputDir,
      batch.outputDir,
      ...batch.shards.flatMap((shard) => shard.artifactPath === undefined ? [] : [shard.artifactPath]),
    ]))
  } catch {
    return []
  }
}

async function findMissingDeckRendererBackendReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const entries = await collectArtifactFiles(artifactsDir, artifactsDir)
    const artifactNames = entries.map((entry) => entry.name).filter((name) => /^deck-renderer-(motion-canvas|remotion)\.json$/.test(name))
    const nested = await Promise.all(artifactNames.map(async (name) => {
      const artifact = DeckRendererBackendProjectSchema.parse(await bunFile(resolve(artifactsDir, name)).json())
      const projectDir = resolve(artifactsDir, '..')

      return findMissingProjectPathReferences(projectDir, uniquePaths([
        artifact.commandCwd,
        artifact.outputDir,
        artifact.motionTimelinePath,
        ...Object.values(artifact.files),
      ]))
    }))

    return nested.flat()
  } catch {
    return []
  }
}

async function findMissingDeckRendererRemotionOutputReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const output = DeckRendererRemotionOutputSchema.parse(await bunFile(resolve(artifactsDir, 'deck-renderer-remotion-output.json')).json())
    const projectDir = resolve(artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths([
      output.commandCwd,
      output.exportArtifactPath,
      output.outputPath,
      output.rendererProjectDir,
    ]))
  } catch {
    return []
  }
}

async function findMissingDeckKeyframeReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const keyframes = DeckKeyframesSchema.parse(await bunFile(resolve(artifactsDir, 'deck-keyframes.json')).json())
    const projectDir = resolve(artifactsDir, '..')

    return findMissingProjectPathReferences(projectDir, uniquePaths(keyframes.samples.map((sample) => sample.path)))
  } catch {
    return []
  }
}

async function findMissingDeckReviewReportReferences(artifactsDir: string): Promise<ArtifactIntegrityMissingIssue[]> {
  try {
    const report = DeckReviewReportSchema.parse(await bunFile(resolve(artifactsDir, 'review-report.json')).json())
    const projectDir = resolve(artifactsDir, '..')
    const paths = uniquePaths([
      report.keyframeQualityPath,
      report.outputPath,
      report.reviewHtmlPath,
      ...report.slides.map((slide) => slide.keyframe?.path),
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
      renderOutput.reviewHtmlPath,
      renderOutput.reviewReportPath,
      renderOutput.audioPath,
      renderOutput.audioMixPath,
      renderOutput.frameManifestPath,
      renderOutput.keyframeQualityPath,
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

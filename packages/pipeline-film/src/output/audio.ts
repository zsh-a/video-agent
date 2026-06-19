import {NarrationSchema, OutputTimelineMapSchema, SourceManifestSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {resolve} from 'node:path'

import {assertFileExists, refreshArtifactManifest} from '@video-agent/runtime'
import {createFilmAudioMixArtifact, writeFilmRenderOutputArtifact, writeFilmSubtitles} from './artifacts.js'
import type {
  CreateFilmAudioMixProjectOptions,
  CreateFilmAudioMixProjectResult,
  CreateFilmFinalRenderProjectOptions,
  CreateFilmFinalRenderProjectResult,
  CreateFilmSubtitleProjectOptions,
  CreateFilmSubtitleProjectResult,
} from './types.js'
import {createAudioMixVoiceovers, readFilmAudioMix, readFilmSubtitles, renderAudioMix, renderFinalFilmVideo} from '../render/index.js'
import {completeFilmStage, failFilmStage, openFilmStageWorkspace} from '../shared/stage-runtime.js'
import {resolveProjectPath} from '../shared/utils.js'

export async function createFilmAudioMixProject(options: CreateFilmAudioMixProjectOptions): Promise<CreateFilmAudioMixProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'mix-audio',
    workspaceDir,
  })

  try {
    const [outputTimelineMap, narration, sourceManifest, ttsSegments] = await Promise.all([
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
      NarrationSchema.parseAsync(await workspace.store.readJson('narration.json')),
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      TtsSegmentsSchema.parseAsync(await workspace.store.readJson('tts-segments.json')),
    ])
    const outputPath = resolve(workspace.audioDir, 'audio_mix.wav')
    const editedSourcePath = resolve(workspace.rendersDir, 'edited_source.mp4')
    const sourceAudioPath = sourceManifest.audioTracks > 0 ? editedSourcePath : undefined
    const voiceoverSegments = await createAudioMixVoiceovers(workspace.projectDir, narration, ttsSegments)
    const audioMix = createFilmAudioMixArtifact({
      duration: outputTimelineMap.outputDuration,
      editedSourcePath,
      outputPath,
      projectDir: workspace.projectDir,
      sourceAudioPath,
      voiceoverSegments,
    })

    if (sourceAudioPath !== undefined) {
      await assertFileExists(sourceAudioPath)
    }
    await renderAudioMix(outputPath, outputTimelineMap.outputDuration, sourceAudioPath, voiceoverSegments)

    const artifacts = {
      audioMix: await workspace.store.writeJson('audio-mix.json', audioMix),
    }

    await completeFilmStage(jobStore, workspace, 'mix-audio')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      audioMix,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      status: 'mixed',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'mix-audio', error)
    throw error
  }
}

export async function createFilmSubtitleProject(options: CreateFilmSubtitleProjectOptions): Promise<CreateFilmSubtitleProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'subtitle',
    workspaceDir,
  })

  try {
    const narration = NarrationSchema.parse(await workspace.store.readJson('narration.json'))
    const outputPath = resolve(workspace.rendersDir, 'subtitles.srt')
    const {artifactPath, subtitles} = await writeFilmSubtitles(workspace, narration, outputPath)
    const artifacts = {subtitles: artifactPath}

    await completeFilmStage(jobStore, workspace, 'subtitle')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      status: 'subtitled',
      subtitles,
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'subtitle', error)
    throw error
  }
}

export async function createFilmFinalRenderProject(options: CreateFilmFinalRenderProjectOptions): Promise<CreateFilmFinalRenderProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'render-final',
    workspaceDir,
  })

  try {
    const [audioMix, subtitles, outputTimelineMap] = await Promise.all([
      readFilmAudioMix(workspace.store.readJson('audio-mix.json')),
      readFilmSubtitles(workspace.store.readJson('subtitles.json')),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
    ])
    const editedSourcePath = resolve(workspace.rendersDir, 'edited_source.mp4')
    const audioMixPath = resolveProjectPath(workspace.projectDir, audioMix.outputPath)
    const subtitlePath = resolveProjectPath(workspace.projectDir, subtitles.path)
    const outputPath = resolve(workspace.rendersDir, 'final.mp4')

    await Promise.all([
      assertFileExists(editedSourcePath),
      assertFileExists(audioMixPath),
      assertFileExists(subtitlePath),
    ])
    const finalRender = await renderFinalFilmVideo({
      audioMixPath,
      editedSourcePath,
      outputPath,
      subtitlePath,
    })

    const artifactPath = await writeFilmRenderOutputArtifact(workspace, {
      audioMix,
      editedSourcePath,
      finalRender,
      outputDuration: outputTimelineMap.outputDuration,
      outputPath,
      subtitlePath,
      subtitles,
    })

    await completeFilmStage(jobStore, workspace, 'render-final')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      audioInputs: 1,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      renderer: 'ffmpeg',
      status: 'rendered',
      subtitlePath,
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'render-final', error)
    throw error
  }
}

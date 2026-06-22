import {OutputNarrationSchema, OutputTimelineMapSchema, SourceManifestSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {resolve} from 'node:path'

import {AUDIO_MIX_ARTIFACT_NAME, FFMPEG_RENDER_OUTPUT_RENDERER, OUTPUT_NARRATION_ARTIFACT_NAME, OUTPUT_TIMELINE_MAP_ARTIFACT_NAME, SOURCE_MANIFEST_ARTIFACT_NAME, SUBTITLES_ARTIFACT_NAME, TTS_SEGMENTS_ARTIFACT_NAME, refreshArtifactManifest, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import {createFilmAudioMixArtifact, writeFilmRenderOutputArtifact, writeFilmSubtitles} from './artifacts.js'
import {FILM_STAGE_IDS} from '../pipeline.js'
import type {
  CreateFilmAudioMixProjectOptions,
  CreateFilmAudioMixProjectResult,
  CreateFilmFinalRenderProjectOptions,
  CreateFilmFinalRenderProjectResult,
  CreateFilmSubtitleProjectOptions,
  CreateFilmSubtitleProjectResult,
} from './types.js'
import {createAudioMixVoiceovers, readFilmAudioMix, readFilmSubtitles, renderAudioMix, renderFinalFilmVideo} from '../render/index.js'
import {openFilmStageWorkspace} from '../shared/stage-runtime.js'
import {assertFileExists, resolveProjectPath} from '../shared/utils.js'

export async function createFilmAudioMixProject(options: CreateFilmAudioMixProjectOptions): Promise<CreateFilmAudioMixProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.mixAudio,
    workspaceDir,
  })

  try {
    const [outputTimelineMap, outputNarration, sourceManifest, ttsSegments] = await Promise.all([
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson(OUTPUT_TIMELINE_MAP_ARTIFACT_NAME)),
      OutputNarrationSchema.parseAsync(await workspace.store.readJson(OUTPUT_NARRATION_ARTIFACT_NAME)),
      SourceManifestSchema.parseAsync(await workspace.store.readJson(SOURCE_MANIFEST_ARTIFACT_NAME)),
      TtsSegmentsSchema.parseAsync(await workspace.store.readJson(TTS_SEGMENTS_ARTIFACT_NAME)),
    ])
    const outputPath = resolve(workspace.audioDir, 'audio_mix.wav')
    const editedSourcePath = resolve(workspace.rendersDir, 'edited_source.mp4')
    const sourceAudioPath = sourceManifest.audioTracks > 0 ? editedSourcePath : undefined
    const voiceoverSegments = await createAudioMixVoiceovers(workspace.projectDir, outputNarration, ttsSegments)
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
      audioMix: await workspace.store.writeJson(AUDIO_MIX_ARTIFACT_NAME, audioMix),
    }

    await agent.completeStage(FILM_STAGE_IDS.mixAudio)
    await agent.completeRun('Film stage mix-audio complete')
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
    await agent.failStage(FILM_STAGE_IDS.mixAudio, error)
    await agent.failRun(error)
    throw error
  }
}

export async function createFilmSubtitleProject(options: CreateFilmSubtitleProjectOptions): Promise<CreateFilmSubtitleProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.subtitle,
    workspaceDir,
  })

  try {
    const outputNarration = OutputNarrationSchema.parse(await workspace.store.readJson(OUTPUT_NARRATION_ARTIFACT_NAME))
    const outputPath = resolve(workspace.rendersDir, 'subtitles.srt')
    const {artifactPath, subtitles} = await writeFilmSubtitles(workspace, outputNarration, outputPath)
    const artifacts = {subtitles: artifactPath}

    await agent.completeStage(FILM_STAGE_IDS.subtitle)
    await agent.completeRun('Film stage subtitle complete')
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
    await agent.failStage(FILM_STAGE_IDS.subtitle, error)
    await agent.failRun(error)
    throw error
  }
}

export async function createFilmFinalRenderProject(options: CreateFilmFinalRenderProjectOptions): Promise<CreateFilmFinalRenderProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.renderFinal,
    workspaceDir,
  })

  try {
    const [audioMix, subtitles, outputTimelineMap] = await Promise.all([
      readFilmAudioMix(workspace.store.readJson(AUDIO_MIX_ARTIFACT_NAME)),
      readFilmSubtitles(workspace.store.readJson(SUBTITLES_ARTIFACT_NAME)),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson(OUTPUT_TIMELINE_MAP_ARTIFACT_NAME)),
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

    await agent.completeStage(FILM_STAGE_IDS.renderFinal)
    await agent.completeRun('Film stage render-final complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      audioInputs: 1,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      renderer: FFMPEG_RENDER_OUTPUT_RENDERER,
      status: 'rendered',
      subtitlePath,
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.renderFinal, error)
    await agent.failRun(error)
    throw error
  }
}

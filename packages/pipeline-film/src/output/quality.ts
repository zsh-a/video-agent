import {OutputNarrationSchema, OutputTimelineMapSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'

import {OUTPUT_NARRATION_ARTIFACT_NAME, OUTPUT_TIMELINE_MAP_ARTIFACT_NAME, QUALITY_REPORT_ARTIFACT_NAME, RENDER_OUTPUT_ARTIFACT_NAME, TTS_SEGMENTS_ARTIFACT_NAME, refreshArtifactManifest, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import {createFilmQualityReport, type FilmQualityReport} from './artifacts.js'
import {FILM_STAGE_IDS} from '../pipeline.js'
import type {CreateFilmQualityCheckProjectOptions, CreateFilmQualityCheckProjectResult} from './types.js'
import {FilmRenderOutputArtifactSchema} from '../render/index.js'
import {openFilmStageWorkspace} from '../shared/stage-runtime.js'

export type {FilmQualityReport}

export async function createFilmQualityCheckProject(options: CreateFilmQualityCheckProjectOptions): Promise<CreateFilmQualityCheckProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR
  const {agent, jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.qualityCheck,
    workspaceDir,
  })

  try {
    const [renderOutput, outputNarration, ttsSegments, outputTimelineMap] = await Promise.all([
      FilmRenderOutputArtifactSchema.parseAsync(await workspace.store.readJson(RENDER_OUTPUT_ARTIFACT_NAME)),
      OutputNarrationSchema.parseAsync(await workspace.store.readJson(OUTPUT_NARRATION_ARTIFACT_NAME)),
      TtsSegmentsSchema.parseAsync(await workspace.store.readJson(TTS_SEGMENTS_ARTIFACT_NAME)),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson(OUTPUT_TIMELINE_MAP_ARTIFACT_NAME)),
    ])
    const qualityReport = createFilmQualityReport({
      outputNarration,
      outputTimelineMap,
      renderOutput,
      ttsSegments,
    })
    const artifactPath = await workspace.store.writeJson(QUALITY_REPORT_ARTIFACT_NAME, qualityReport)

    await agent.completeStage(FILM_STAGE_IDS.qualityCheck)
    await agent.completeRun('Film stage quality-check complete')
    await jobStore.complete(qualityReport.summary.errors === 0 ? 'completed' : 'failed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifactPath,
      projectDir: workspace.projectDir,
      projectId,
      qualityReport,
      status: 'checked',
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.qualityCheck, error)
    await agent.failRun(error)
    throw error
  }
}

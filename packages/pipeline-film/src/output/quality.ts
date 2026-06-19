import {NarrationSchema, OutputTimelineMapSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'

import {refreshArtifactManifest} from '@video-agent/runtime'
import {createFilmQualityReport, type FilmQualityReport} from './artifacts.js'
import type {CreateFilmQualityCheckProjectOptions, CreateFilmQualityCheckProjectResult} from './types.js'
import type {FilmRenderOutputArtifact} from '../render/index.js'
import {completeFilmStage, failFilmStage, openFilmStageWorkspace} from '../shared/stage-runtime.js'

export type {FilmQualityReport}

export async function createFilmQualityCheckProject(options: CreateFilmQualityCheckProjectOptions): Promise<CreateFilmQualityCheckProjectResult> {
  const projectId = options.projectId
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'quality-check',
    workspaceDir,
  })

  try {
    const [renderOutput, narration, ttsSegments, outputTimelineMap] = await Promise.all([
      workspace.store.readJson('render-output.json') as Promise<FilmRenderOutputArtifact>,
      NarrationSchema.parseAsync(await workspace.store.readJson('narration.json')),
      TtsSegmentsSchema.parseAsync(await workspace.store.readJson('tts-segments.json')),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
    ])
    const qualityReport = createFilmQualityReport({
      narration,
      outputTimelineMap,
      renderOutput,
      ttsSegments,
    })
    const artifactPath = await workspace.store.writeJson('quality-report.json', qualityReport)

    await completeFilmStage(jobStore, workspace, 'quality-check')
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
    await failFilmStage(jobStore, workspace, 'quality-check', error)
    throw error
  }
}

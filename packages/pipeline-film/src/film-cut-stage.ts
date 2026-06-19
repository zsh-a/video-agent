import {ClipPlanSchema, OutputTimelineMapSchema, SourceManifestSchema} from '@video-agent/ir'
import {resolve} from 'node:path'

import {refreshArtifactManifest} from '@video-agent/runtime'
import {createOutputTimelineMap, validateClipPlanForCut} from './film-clip-plan.js'
import type {CreateFilmCutProjectOptions, CreateFilmCutProjectResult} from './film-output-stage-types.js'
import {renderCutVideo} from './film-rendering.js'
import {completeFilmStage, failFilmStage, openFilmStageWorkspace} from './film-stage-runtime.js'

export async function createFilmCutProject(options: CreateFilmCutProjectOptions): Promise<CreateFilmCutProjectResult> {
  const projectId = options.projectId
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'render-cut',
    workspaceDir: options.workspaceDir,
  })

  try {
    const [clipPlan, sourceManifest] = await Promise.all([
      ClipPlanSchema.parseAsync(await workspace.store.readJson('clip-plan.json')),
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
    ])
    const validatedClipPlan = ClipPlanSchema.parse(validateClipPlanForCut(clipPlan))
    const outputTimelineMap = OutputTimelineMapSchema.parse(createOutputTimelineMap(validatedClipPlan))
    const outputPath = resolve(workspace.rendersDir, 'edited_source.mp4')

    await renderCutVideo(validatedClipPlan, outputPath, sourceManifest.audioTracks > 0)

    const artifacts = {
      clipPlanValidated: await workspace.store.writeJson('clip-plan-validated.json', validatedClipPlan),
      outputTimelineMap: await workspace.store.writeJson('output-timeline-map.json', outputTimelineMap),
    }

    await completeFilmStage(jobStore, workspace, 'render-cut')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      status: 'cut',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'render-cut', error)
    throw error
  }
}

import {ClipPlanSchema, OutputTimelineMapSchema, SourceManifestSchema} from '@video-agent/ir'
import {resolve} from 'node:path'

import {CLIP_PLAN_ARTIFACT_NAME, CLIP_PLAN_VALIDATED_ARTIFACT_NAME, OUTPUT_TIMELINE_MAP_ARTIFACT_NAME, SOURCE_MANIFEST_ARTIFACT_NAME, refreshArtifactManifest} from '@video-agent/runtime'
import {createOutputTimelineMap, validateClipPlanForCut} from '../planning/clip-plan.js'
import {FILM_STAGE_IDS} from '../pipeline.js'
import type {CreateFilmCutProjectOptions, CreateFilmCutProjectResult} from './types.js'
import {renderCutVideo} from '../render/index.js'
import {openFilmStageWorkspace} from '../shared/stage-runtime.js'

export async function createFilmCutProject(options: CreateFilmCutProjectOptions): Promise<CreateFilmCutProjectResult> {
  const projectId = options.projectId
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.renderCut,
    workspaceDir: options.workspaceDir,
  })

  try {
    const [clipPlan, sourceManifest] = await Promise.all([
      ClipPlanSchema.parseAsync(await workspace.store.readJson(CLIP_PLAN_ARTIFACT_NAME)),
      SourceManifestSchema.parseAsync(await workspace.store.readJson(SOURCE_MANIFEST_ARTIFACT_NAME)),
    ])
    const validatedClipPlan = ClipPlanSchema.parse(validateClipPlanForCut(clipPlan))
    const outputTimelineMap = OutputTimelineMapSchema.parse(createOutputTimelineMap(validatedClipPlan))
    const outputPath = resolve(workspace.rendersDir, 'edited_source.mp4')

    await renderCutVideo(validatedClipPlan, outputPath, sourceManifest.audioTracks > 0)

    const artifacts = {
      clipPlanValidated: await workspace.store.writeJson(CLIP_PLAN_VALIDATED_ARTIFACT_NAME, validatedClipPlan),
      outputTimelineMap: await workspace.store.writeJson(OUTPUT_TIMELINE_MAP_ARTIFACT_NAME, outputTimelineMap),
    }

    await agent.completeStage(FILM_STAGE_IDS.renderCut)
    await agent.completeRun('Film stage render-cut complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      outputPath,
      projectDir: workspace.projectDir,
      projectId,
      status: 'cut',
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.renderCut, error)
    await agent.failRun(error)
    throw error
  }
}

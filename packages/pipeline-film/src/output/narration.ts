import {ASRResultSchema, ClipPlanSchema, OutputNarrationSchema, OutputTimelineMapSchema, RecapScriptSchema, StoryIndexSchema} from '@video-agent/ir'

import {ASR_RESULT_ARTIFACT_NAME, CLIP_PLAN_VALIDATED_ARTIFACT_NAME, OUTPUT_NARRATION_ARTIFACT_NAME, OUTPUT_TIMELINE_MAP_ARTIFACT_NAME, RECAP_SCRIPT_ARTIFACT_NAME, STORY_INDEX_ARTIFACT_NAME, refreshArtifactManifest} from '@video-agent/runtime'
import {createOutputNarration} from '../planning/narration.js'
import {FILM_STAGE_IDS} from '../pipeline.js'
import type {CreateFilmOutputNarrationProjectOptions, CreateFilmOutputNarrationProjectResult} from './types.js'
import {openFilmStageWorkspace} from '../shared/stage-runtime.js'

export async function createFilmOutputNarrationProject(options: CreateFilmOutputNarrationProjectOptions): Promise<CreateFilmOutputNarrationProjectResult> {
  const projectId = options.projectId
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.narrateOutput,
    workspaceDir: options.workspaceDir,
  })

  try {
    const [clipPlan, outputTimelineMap, storyIndex, asrResult, recapScript] = await Promise.all([
      ClipPlanSchema.parseAsync(await workspace.store.readJson(CLIP_PLAN_VALIDATED_ARTIFACT_NAME)),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson(OUTPUT_TIMELINE_MAP_ARTIFACT_NAME)),
      StoryIndexSchema.parseAsync(await workspace.store.readJson(STORY_INDEX_ARTIFACT_NAME)),
      ASRResultSchema.parseAsync(await workspace.store.readJson(ASR_RESULT_ARTIFACT_NAME)),
      RecapScriptSchema.parseAsync(await workspace.store.readJson(RECAP_SCRIPT_ARTIFACT_NAME)),
    ])
    const outputNarration = OutputNarrationSchema.parse(createOutputNarration(clipPlan, outputTimelineMap, storyIndex, asrResult, options.language ?? storyIndex.language, recapScript))
    const artifacts = {
      outputNarration: await workspace.store.writeJson(OUTPUT_NARRATION_ARTIFACT_NAME, outputNarration),
    }

    await agent.completeStage(FILM_STAGE_IDS.narrateOutput)
    await agent.completeRun('Film stage narrate-output complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      segments: outputNarration.segments.length,
      status: 'narrated',
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.narrateOutput, error)
    await agent.failRun(error)
    throw error
  }
}

import {ASRResultSchema, ClipPlanSchema, NarrationSchema, OutputNarrationSchema, OutputTimelineMapSchema, RecapScriptSchema, StoryIndexSchema} from '@video-agent/ir'

import {refreshArtifactManifest} from '@video-agent/runtime'
import {createCompatibleNarration, createOutputNarration} from './film-narration.js'
import type {CreateFilmOutputNarrationProjectOptions, CreateFilmOutputNarrationProjectResult} from './film-output-stage-types.js'
import {completeFilmStage, failFilmStage, openFilmStageWorkspace} from './film-stage-runtime.js'

export async function createFilmOutputNarrationProject(options: CreateFilmOutputNarrationProjectOptions): Promise<CreateFilmOutputNarrationProjectResult> {
  const projectId = options.projectId
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'narrate-output',
    workspaceDir: options.workspaceDir,
  })

  try {
    const [clipPlan, outputTimelineMap, storyIndex, asrResult, recapScript] = await Promise.all([
      ClipPlanSchema.parseAsync(await workspace.store.readJson('clip-plan-validated.json')),
      OutputTimelineMapSchema.parseAsync(await workspace.store.readJson('output-timeline-map.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      ASRResultSchema.parseAsync(await workspace.store.readJson('asr-result.json')),
      RecapScriptSchema.parseAsync(await workspace.store.readJson('recap-script.json')),
    ])
    const outputNarration = OutputNarrationSchema.parse(createOutputNarration(clipPlan, outputTimelineMap, storyIndex, asrResult, options.language ?? storyIndex.language, recapScript))
    const narration = NarrationSchema.parse(createCompatibleNarration(outputNarration))
    const artifacts = {
      outputNarration: await workspace.store.writeJson('output-narration.json', outputNarration),
      narration: await workspace.store.writeJson('narration.json', narration),
    }

    await completeFilmStage(jobStore, workspace, 'narrate-output')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      segments: outputNarration.segments.length,
      status: 'narrated',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'narrate-output', error)
    throw error
  }
}

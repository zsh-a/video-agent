import {ASRResultSchema, ClipPlanSchema, RecapScriptSchema, SourceManifestSchema, StoryIndexSchema, TimelineFusionSchema, VLMAnalysisSchema} from '@video-agent/ir'

import {ASR_RESULT_ARTIFACT_NAME, CHARACTER_INDEX_ARTIFACT_NAME, CLIP_PLAN_ARTIFACT_NAME, NARRATIVE_BEATS_ARTIFACT_NAME, RECAP_SCRIPT_ARTIFACT_NAME, SOURCE_MANIFEST_ARTIFACT_NAME, STORY_INDEX_ARTIFACT_NAME, TIMELINE_FUSION_ARTIFACT_NAME, VLM_ANALYSIS_ARTIFACT_NAME, createRuntimeScriptProvider, instrumentScriptProvider, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {createFilmClipPlan} from './clip-plan.js'
import {FILM_STAGE_IDS} from '../pipeline.js'
import type {
  CreateFilmClipPlanProjectOptions,
  CreateFilmClipPlanProjectResult,
  CreateFilmRecapScriptProjectOptions,
  CreateFilmRecapScriptProjectResult,
  CreateFilmStoryIndexProjectOptions,
  CreateFilmStoryIndexProjectResult,
} from '../project/types.js'
import {createFilmProviderCallRecorder, openFilmStageWorkspace} from '../shared/stage-runtime.js'
import {validateGeneratedRecapScript, validateGeneratedStoryIndex} from './validation.js'

export async function createFilmStoryIndexProject(options: CreateFilmStoryIndexProjectOptions): Promise<CreateFilmStoryIndexProjectResult> {
  const projectId = options.projectId
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.buildStoryIndex,
    workspaceDir: options.workspaceDir,
  })

  try {
    const config = await readConfig(workspace.workspaceDir)
    const scriptProvider = instrumentScriptProvider(
      await createRuntimeScriptProvider(config, workspace.workspaceDir, {
        llmClient: options.llmClient,
      }),
      createFilmProviderCallRecorder(workspace),
    )
    const [sourceManifest, timelineFusion, asrResult, vlmAnalysis] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson(SOURCE_MANIFEST_ARTIFACT_NAME)),
      TimelineFusionSchema.parseAsync(await workspace.store.readJson(TIMELINE_FUSION_ARTIFACT_NAME)),
      ASRResultSchema.parseAsync(await workspace.store.readJson(ASR_RESULT_ARTIFACT_NAME)),
      VLMAnalysisSchema.parseAsync(await workspace.store.readJson(VLM_ANALYSIS_ARTIFACT_NAME)),
    ])
    const language = options.language ?? asrResult.language

    if (language === 'unknown') {
      throw new Error('Film Recap story indexing requires an explicit language from options or ASR; no language fallback is allowed.')
    }

    const indexed = validateGeneratedStoryIndex(await scriptProvider.createStoryIndex({
      asrResult,
      language,
      sourceManifest,
      timelineFusion,
      vlmAnalysis,
    }), sourceManifest)
    const artifacts = {
      storyIndex: await workspace.store.writeJson(STORY_INDEX_ARTIFACT_NAME, indexed.storyIndex),
      narrativeBeats: await workspace.store.writeJson(NARRATIVE_BEATS_ARTIFACT_NAME, indexed.narrativeBeats),
      characterIndex: await workspace.store.writeJson(CHARACTER_INDEX_ARTIFACT_NAME, indexed.characterIndex),
    }

    await agent.completeStage(FILM_STAGE_IDS.buildStoryIndex)
    await agent.completeRun('Film stage build-story-index complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      beats: indexed.narrativeBeats.beats.length,
      projectDir: workspace.projectDir,
      projectId,
      status: 'indexed',
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.buildStoryIndex, error)
    await agent.failRun(error)
    throw error
  }
}

export async function createFilmRecapScriptProject(options: CreateFilmRecapScriptProjectOptions): Promise<CreateFilmRecapScriptProjectResult> {
  const projectId = options.projectId
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.writeScript,
    workspaceDir: options.workspaceDir,
  })

  try {
    const config = await readConfig(workspace.workspaceDir)
    const scriptProvider = instrumentScriptProvider(
      await createRuntimeScriptProvider(config, workspace.workspaceDir, {
        llmClient: options.llmClient,
      }),
      createFilmProviderCallRecorder(workspace),
    )
    const [sourceManifest, storyIndex, asrResult, vlmAnalysis] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson(SOURCE_MANIFEST_ARTIFACT_NAME)),
      StoryIndexSchema.parseAsync(await workspace.store.readJson(STORY_INDEX_ARTIFACT_NAME)),
      ASRResultSchema.parseAsync(await workspace.store.readJson(ASR_RESULT_ARTIFACT_NAME)),
      VLMAnalysisSchema.parseAsync(await workspace.store.readJson(VLM_ANALYSIS_ARTIFACT_NAME)),
    ])
    const recapScript = validateGeneratedRecapScript(RecapScriptSchema.parse(await scriptProvider.createRecapScript({
      asrResult,
      sourceManifest,
      storyIndex,
      targetDurationSeconds: options.targetDurationSeconds,
      vlmAnalysis,
    })), storyIndex, sourceManifest, options.targetDurationSeconds)
    const artifacts = {
      recapScript: await workspace.store.writeJson(RECAP_SCRIPT_ARTIFACT_NAME, recapScript),
    }

    await agent.completeStage(FILM_STAGE_IDS.writeScript)
    await agent.completeRun('Film stage write-script complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId,
      segments: recapScript.segments.length,
      status: 'scripted',
      totalEstimatedDuration: recapScript.totalEstimatedDuration,
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.writeScript, error)
    await agent.failRun(error)
    throw error
  }
}

export async function createFilmClipPlanProject(options: CreateFilmClipPlanProjectOptions): Promise<CreateFilmClipPlanProjectResult> {
  const projectId = options.projectId
  const {agent, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: FILM_STAGE_IDS.planClips,
    workspaceDir: options.workspaceDir,
  })

  try {
    const [sourceManifest, storyIndex, recapScript] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson(SOURCE_MANIFEST_ARTIFACT_NAME)),
      StoryIndexSchema.parseAsync(await workspace.store.readJson(STORY_INDEX_ARTIFACT_NAME)),
      RecapScriptSchema.parseAsync(await workspace.store.readJson(RECAP_SCRIPT_ARTIFACT_NAME)),
    ])
    const clipPlan = ClipPlanSchema.parse(createFilmClipPlan(sourceManifest, storyIndex, options.targetDurationSeconds, recapScript))
    const artifacts = {
      clipPlan: await workspace.store.writeJson(CLIP_PLAN_ARTIFACT_NAME, clipPlan),
    }

    await agent.completeStage(FILM_STAGE_IDS.planClips)
    await agent.completeRun('Film stage plan-clips complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      clips: clipPlan.clips.length,
      duration: clipPlan.duration,
      projectDir: workspace.projectDir,
      projectId,
      status: 'planned',
    }
  } catch (error) {
    await agent.failStage(FILM_STAGE_IDS.planClips, error)
    await agent.failRun(error)
    throw error
  }
}

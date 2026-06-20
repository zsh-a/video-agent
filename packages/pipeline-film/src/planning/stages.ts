import {ASRResultSchema, ClipPlanSchema, RecapScriptSchema, SourceManifestSchema, StoryIndexSchema, TimelineFusionSchema, VLMAnalysisSchema} from '@video-agent/ir'

import {createRuntimeProviders, instrumentProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {createFilmClipPlan} from './clip-plan.js'
import type {
  CreateFilmClipPlanProjectOptions,
  CreateFilmClipPlanProjectResult,
  CreateFilmRecapScriptProjectOptions,
  CreateFilmRecapScriptProjectResult,
  CreateFilmStoryIndexProjectOptions,
  CreateFilmStoryIndexProjectResult,
} from '../project/types.js'
import {completeFilmStage, createFilmProviderCallRecorder, failFilmStage, openFilmStageWorkspace} from '../shared/stage-runtime.js'
import {validateGeneratedRecapScript, validateGeneratedStoryIndex} from './validation.js'

export async function createFilmStoryIndexProject(options: CreateFilmStoryIndexProjectOptions): Promise<CreateFilmStoryIndexProjectResult> {
  const projectId = options.projectId
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'build-story-index',
    workspaceDir: options.workspaceDir,
  })

  try {
    const config = await readConfig(workspace.workspaceDir)
    const providers = instrumentProviders(
      await createRuntimeProviders(config, workspace.workspaceDir, {
        llmClient: options.llmClient,
      }),
      config.providers,
      createFilmProviderCallRecorder(workspace),
    )
    const [sourceManifest, timelineFusion, asrResult, vlmAnalysis] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      TimelineFusionSchema.parseAsync(await workspace.store.readJson('timeline-fusion.json')),
      ASRResultSchema.parseAsync(await workspace.store.readJson('asr-result.json')),
      VLMAnalysisSchema.parseAsync(await workspace.store.readJson('vlm-analysis.json')),
    ])
    const language = options.language ?? asrResult.language

    if (language === 'unknown') {
      throw new Error('Film Recap story indexing requires an explicit language from options or ASR; no language fallback is allowed.')
    }

    const indexed = validateGeneratedStoryIndex(await providers.script.createStoryIndex({
      asrResult,
      language,
      sourceManifest,
      timelineFusion,
      vlmAnalysis,
    }), sourceManifest)
    const artifacts = {
      storyIndex: await workspace.store.writeJson('story-index.json', indexed.storyIndex),
      narrativeBeats: await workspace.store.writeJson('narrative-beats.json', indexed.narrativeBeats),
      characterIndex: await workspace.store.writeJson('character-index.json', indexed.characterIndex),
    }

    await completeFilmStage(jobStore, workspace, 'build-story-index')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      beats: indexed.narrativeBeats.beats.length,
      projectDir: workspace.projectDir,
      projectId,
      status: 'indexed',
    }
  } catch (error) {
    await failFilmStage(jobStore, workspace, 'build-story-index', error)
    throw error
  }
}

export async function createFilmRecapScriptProject(options: CreateFilmRecapScriptProjectOptions): Promise<CreateFilmRecapScriptProjectResult> {
  const projectId = options.projectId
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'write-script',
    workspaceDir: options.workspaceDir,
  })

  try {
    const config = await readConfig(workspace.workspaceDir)
    const providers = instrumentProviders(
      await createRuntimeProviders(config, workspace.workspaceDir, {
        llmClient: options.llmClient,
      }),
      config.providers,
      createFilmProviderCallRecorder(workspace),
    )
    const [sourceManifest, storyIndex, asrResult, vlmAnalysis] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      ASRResultSchema.parseAsync(await workspace.store.readJson('asr-result.json')),
      VLMAnalysisSchema.parseAsync(await workspace.store.readJson('vlm-analysis.json')),
    ])
    const recapScript = validateGeneratedRecapScript(RecapScriptSchema.parse(await providers.script.createRecapScript({
      asrResult,
      sourceManifest,
      storyIndex,
      targetDurationSeconds: options.targetDurationSeconds,
      vlmAnalysis,
    })), storyIndex, sourceManifest, options.targetDurationSeconds)
    const artifacts = {
      recapScript: await workspace.store.writeJson('recap-script.json', recapScript),
    }

    await completeFilmStage(jobStore, workspace, 'write-script')
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
    await failFilmStage(jobStore, workspace, 'write-script', error)
    throw error
  }
}

export async function createFilmClipPlanProject(options: CreateFilmClipPlanProjectOptions): Promise<CreateFilmClipPlanProjectResult> {
  const projectId = options.projectId
  const {jobStore, workspace} = await openFilmStageWorkspace({
    projectId,
    stage: 'plan-clips',
    workspaceDir: options.workspaceDir,
  })

  try {
    const [sourceManifest, storyIndex, recapScript] = await Promise.all([
      SourceManifestSchema.parseAsync(await workspace.store.readJson('source-manifest.json')),
      StoryIndexSchema.parseAsync(await workspace.store.readJson('story-index.json')),
      RecapScriptSchema.parseAsync(await workspace.store.readJson('recap-script.json')),
    ])
    const clipPlan = ClipPlanSchema.parse(createFilmClipPlan(sourceManifest, storyIndex, options.targetDurationSeconds, recapScript))
    const artifacts = {
      clipPlan: await workspace.store.writeJson('clip-plan.json', clipPlan),
    }

    await completeFilmStage(jobStore, workspace, 'plan-clips')
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
    await failFilmStage(jobStore, workspace, 'plan-clips', error)
    throw error
  }
}

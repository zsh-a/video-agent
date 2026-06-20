import {resolve} from 'node:path'

import {assertFileExists, bunFile, createProjectWorkspace, createRuntimeLLMClient, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {createLLMTextDeckProjectPlan, type TextDeckProjectPlan} from '../planning/index.js'
import {writeDeckTextPlanArtifacts} from './artifacts.js'
import {completeDeckJobStages, initializeDeckJob} from './job.js'
import {
  createDeckJobStore,
  createProjectLLMTrace,
  DEFAULT_MAX_SLIDE_CHARACTERS,
  withLLMTracePath,
} from './runtime.js'
import type {CreateDeckExplainerProjectOptions, CreateDeckExplainerProjectResult} from './types.js'
import {DECK_STAGES} from '../shared/stages.js'

export async function createDeckExplainerProject(options: CreateDeckExplainerProjectOptions): Promise<CreateDeckExplainerProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const text = await bunFile(inputPath).text()

  if (text.trim() === '') {
    throw new Error('Text explainer input must not be empty.')
  }

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const llmTrace = createProjectLLMTrace(workspace, options.trace)
  const language = options.language ?? 'auto'
  const config = await readConfig(workspace.workspaceDir)
  const llmClient = await createRuntimeLLMClient(config, workspace.workspaceDir, {
    llmClient: options.llmClient,
    llmTrace: llmTrace.recorder,
  })
  let plan: TextDeckProjectPlan

  try {
    if (llmClient === undefined) {
      throw new Error('Deck explainer planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
    }

    plan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      deckFormat: options.deckFormat,
      durationTargetSeconds: options.durationTargetSeconds,
      language,
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      requiredSlideTypes: options.requiredSlideTypes,
      sourceType: options.sourceType,
      theme: options.theme,
      title: options.title,
    })
  } catch (error) {
    throw withLLMTracePath(error, llmTrace.path)
  }
  const artifacts = await writeDeckTextPlanArtifacts(workspace, plan, llmTrace.path)
  const jobStore = createDeckJobStore(workspace.projectDir)

  await initializeDeckJob(jobStore, {
    inputPath,
    projectId: workspace.projectId,
    stages: DECK_STAGES,
  })
  await completeDeckJobStages(jobStore, ['ingest', 'source-map', 'understand', 'brief', 'outline', 'plan-slides', 'script', 'timing-preflight'])
  await jobStore.complete('completed')
  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifacts,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    slides: plan.deck.slides.length,
    status: 'completed',
  }
}

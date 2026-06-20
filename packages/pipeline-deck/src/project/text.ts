import {resolve} from 'node:path'

import {assertFileExists, bunFile, createProjectAgentRuntime, createProjectWorkspace, createRuntimeLLMClient, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {createLLMTextDeckProjectPlan, type TextDeckProjectPlan} from '../planning/index.js'
import {writeDeckTextPlanArtifacts} from './artifacts.js'
import {initializeDeckJob} from './job.js'
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
  const jobStore = createDeckJobStore(workspace.projectDir)
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })
  const language = options.language ?? 'auto'
  const config = await readConfig(workspace.workspaceDir)
  const llmClient = await createRuntimeLLMClient(config, workspace.workspaceDir, {
    llmClient: options.llmClient,
    llmTrace: llmTrace.recorder,
  })
  let plan: TextDeckProjectPlan

  await initializeDeckJob(jobStore, {
    inputPath,
    projectId: workspace.projectId,
    stages: DECK_STAGES,
  })
  await agent.startRun('Deck explainer generation started')

  try {
    await agent.startStage('ingest', 'Reading source text')
    await agent.completeStage('ingest', 'Source text loaded')
    await agent.startStage('source-map', 'Building source map')
    await agent.completeStage('source-map', 'Source map prepared')

    if (llmClient === undefined) {
      throw new Error('Deck explainer planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
    }

    plan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      contentDensity: options.contentDensity,
      deckFormat: options.deckFormat,
      durationTargetSeconds: options.durationTargetSeconds,
      language,
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      requiredSlideTypes: options.requiredSlideTypes,
      sourceType: options.sourceType,
      theme: options.theme,
      title: options.title,
    }, agent)
    await agent.startStage('timing-preflight', 'Checking script timing')
    await agent.completeStage('timing-preflight', 'Script timing preflight complete')
  } catch (error) {
    const tracedError = withLLMTracePath(error, llmTrace.path)
    await agent.failRun(tracedError)
    throw tracedError
  }
  const artifacts = await writeDeckTextPlanArtifacts(workspace, plan, llmTrace.path)

  await agent.emit({
    artifact: {
      kind: 'json',
      path: 'artifacts/deck.json',
    },
    level: 'info',
    message: 'Deck planning artifacts written',
    type: 'artifact',
  })
  await jobStore.complete('completed')
  await agent.completeRun('Deck explainer generation complete')
  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifacts,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    slides: plan.deck.slides.length,
    status: 'completed',
  }
}

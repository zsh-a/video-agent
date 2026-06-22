import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {DEFAULT_DECK_LANGUAGE} from '@video-agent/ir'
import {createProjectAgentRuntime, createProjectWorkspace, createRuntimeLLMClient, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {createLLMTextDeckProjectPlan, type TextDeckProjectPlan} from '../planning/index.js'
import {DECK_STAGE_IDS} from '../pipeline.js'
import {writeDeckTextPlanArtifacts} from './artifacts.js'
import {initializeDeckJob} from './job.js'
import {
  createDeckJobStore,
  createProjectLLMTrace,
  DEFAULT_MAX_SLIDE_CHARACTERS,
  withLLMTracePath,
} from './runtime.js'
import type {CreateDeckExplainerProjectOptions, CreateDeckExplainerProjectResult} from './types.js'
import {assertFileExists} from '../shared/utils.js'

export async function createDeckExplainerProject(options: CreateDeckExplainerProjectOptions): Promise<CreateDeckExplainerProjectResult> {
  const inputPath = resolve(options.inputPath)
  await assertFileExists(inputPath)

  const text = await readFile(inputPath, 'utf8')

  if (text.trim() === '') {
    throw new Error('Text explainer input must not be empty.')
  }

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const llmTrace = createProjectLLMTrace(workspace, options.trace)
  const jobStore = await createDeckJobStore({
    projectId: workspace.projectId,
    workspaceDir: workspace.workspaceDir,
  })
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })
  const language = options.language ?? DEFAULT_DECK_LANGUAGE
  const config = await readConfig(workspace.workspaceDir)
  const llmClient = await createRuntimeLLMClient(config, workspace.workspaceDir, {
    llmClient: options.llmClient,
    llmTrace: llmTrace.recorder,
  })
  let plan: TextDeckProjectPlan

  await initializeDeckJob(jobStore, {
    inputPath,
    projectId: workspace.projectId,
  })
  await agent.startRun('Deck explainer generation started')

  try {
    await agent.startStage(DECK_STAGE_IDS.ingest, 'Reading source text')
    await agent.completeStage(DECK_STAGE_IDS.ingest, 'Source text loaded')
    await agent.startStage(DECK_STAGE_IDS.sourceMap, 'Building source map')
    await agent.completeStage(DECK_STAGE_IDS.sourceMap, 'Source map prepared')
    await agent.skipStage(DECK_STAGE_IDS.transcribe, 'Text input does not require transcription')

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
      slideCountMax: options.slideCountMax,
      slideCountTarget: options.slideCountTarget,
      sourceType: options.sourceType,
      theme: options.theme,
      title: options.title,
    }, agent)
    await agent.startStage(DECK_STAGE_IDS.timingPreflight, 'Checking script timing')
    await agent.completeStage(DECK_STAGE_IDS.timingPreflight, 'Script timing preflight complete')
    await agent.skipStage(DECK_STAGE_IDS.align, 'Script-generated deck uses synthesized narration timing')
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

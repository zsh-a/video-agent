import {probeMedia} from '@video-agent/media'
import {TranscriptSchema} from '@video-agent/providers'
import {resolve} from 'node:path'

import {assertFileExists, createProjectWorkspace, createRuntimeLLMClient, createRuntimeProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {isAudioInputPath} from './deck-input.js'
import {createLLMTextDeckProjectPlan} from './deck-planning.js'
import {writeDeckAudioSummaryPlanArtifacts} from './deck-project-artifacts.js'
import {completeDeckJobStages, initializeDeckJob} from './deck-project-job.js'
import {
  createDeckJobStore,
  createProjectLLMTrace,
  DEFAULT_MAX_SLIDE_CHARACTERS,
  DEFAULT_SLIDE_SECONDS,
  withLLMTracePath,
} from './deck-project-runtime.js'
import type {CreateDeckSummarizeProjectOptions, CreateDeckSummarizeProjectResult} from './deck-project-types.js'
import {DECK_SUMMARIZE_STAGES} from './deck-stages.js'
import {normalizeText} from './deck-utils.js'
import {createDeckExplainerProject} from './deck-text-project.js'

export async function createDeckSummarizeProject(options: CreateDeckSummarizeProjectOptions): Promise<CreateDeckSummarizeProjectResult> {
  const inputPath = resolve(options.inputPath)

  if (!isAudioInputPath(inputPath)) {
    return createDeckExplainerProject({
      ...options,
      mode: 'script-generated',
    })
  }

  await assertFileExists(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const workspaceDir = workspace.workspaceDir
  const llmTrace = createProjectLLMTrace(workspace, options.trace)
  const jobStore = createDeckJobStore(workspace.projectDir)

  await initializeDeckJob(jobStore, {
    inputPath,
    projectId: workspace.projectId,
    stages: DECK_SUMMARIZE_STAGES,
  })
  await jobStore.updateStage('ingest', 'running', undefined, 1)

  try {
    const sourceMediaInfo = await probeMedia(inputPath)
    const sourceDuration = sourceMediaInfo.duration ?? DEFAULT_SLIDE_SECONDS
    const config = await readConfig(workspaceDir)
    const llmClient = await createRuntimeLLMClient(config, workspaceDir, {
      llmClient: options.llmClient,
      llmTrace: llmTrace.recorder,
    })

    if (llmClient === undefined) {
      throw new Error('Deck audio summary planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
    }

    const providers = await createRuntimeProviders(config, workspaceDir, {
      llmClient,
      llmTrace: llmTrace.recorder,
    })

    await jobStore.updateStage('ingest', 'completed', undefined, 1)
    await jobStore.updateStage('transcribe', 'running', undefined, 1)

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration: sourceDuration,
      path: inputPath,
    }))
    const text = normalizeText(transcript.text || transcript.segments.map((segment) => segment.text).join('\n\n'))

    if (text === '') {
      throw new Error('Deck summarize audio transcript must not be empty.')
    }

    await jobStore.updateStage('transcribe', 'completed', undefined, 1)
    await jobStore.updateStage('understand', 'running', undefined, 1)

    const language = options.language ?? transcript.language ?? 'zh-CN'
    const plan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      deckFormat: options.deckFormat,
      durationTargetSeconds: options.durationTargetSeconds,
      language,
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      slideSeconds: options.slideSeconds ?? DEFAULT_SLIDE_SECONDS,
      sourceType: 'audio',
      theme: options.theme,
      title: options.title,
    })

    await jobStore.updateStage('understand', 'completed', undefined, 1)
    await jobStore.updateStage('plan', 'running', undefined, 1)

    const artifacts = await writeDeckAudioSummaryPlanArtifacts(workspace, transcript, plan, llmTrace.path)

    await completeDeckJobStages(jobStore, ['plan', 'script', 'quality'])
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      slides: plan.deck.slides.length,
      sourceMode: 'audio-summary',
      status: 'completed',
    }
  } catch (error) {
    const tracedError = withLLMTracePath(error, llmTrace.path)
    await jobStore.updateStage('transcribe', 'failed', tracedError.message, 1)
    throw tracedError
  }
}

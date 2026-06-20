import {probeMedia} from '@video-agent/media'
import {TranscriptSchema} from '@video-agent/providers'
import {resolve} from 'node:path'

import {assertFileExists, createProjectWorkspace, createRuntimeLLMClient, createRuntimeProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {isAudioInputPath} from '../planning/input.js'
import {createLLMTextDeckProjectPlan} from '../planning/index.js'
import {writeDeckAudioSummaryPlanArtifacts} from './artifacts.js'
import {completeDeckJobStages, initializeDeckJob} from './job.js'
import {
	  createDeckJobStore,
	  createProjectLLMTrace,
	  DEFAULT_MAX_SLIDE_CHARACTERS,
	  withLLMTracePath,
	} from './runtime.js'
import type {CreateDeckSummarizeProjectOptions, CreateDeckSummarizeProjectResult} from './types.js'
import {DECK_SUMMARIZE_STAGES} from '../shared/stages.js'
import {requireExactTranscriptSegments, requireExactTranscriptText, requireTranscriptLanguage} from './transcript.js'

export async function createDeckSummarizeProject(options: CreateDeckSummarizeProjectOptions): Promise<CreateDeckSummarizeProjectResult> {
  const inputPath = resolve(options.inputPath)

  if (!isAudioInputPath(inputPath)) {
    throw new Error('Deck audio summary planning requires an audio input path; use Deck explainer planning for text inputs.')
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
    if (sourceMediaInfo.duration === undefined) {
      throw new Error('Deck audio summary planning requires media duration from ffprobe; no default duration fallback is allowed.')
    }

    const sourceDuration = sourceMediaInfo.duration
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
    const transcriptSegments = requireExactTranscriptSegments(transcript, 'Deck audio summary planning')
    const text = requireExactTranscriptText(transcript, 'Deck audio summary planning')

    await jobStore.updateStage('transcribe', 'completed', undefined, 1)
    await jobStore.updateStage('understand', 'running', undefined, 1)

    const language = options.language ?? requireTranscriptLanguage(transcript, 'Deck audio summary planning')
    const plan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      deckFormat: options.deckFormat,
      durationTargetSeconds: options.durationTargetSeconds,
	      language,
	      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
	      requiredSlideTypes: options.requiredSlideTypes,
	      sourceType: 'audio',
      theme: options.theme,
      title: options.title,
      transcriptSegments,
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

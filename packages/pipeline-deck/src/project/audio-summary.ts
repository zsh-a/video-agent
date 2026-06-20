import {probeMedia} from '@video-agent/media'
import {TranscriptSchema} from '@video-agent/providers'
import {resolve} from 'node:path'

import {assertFileExists, createProjectAgentRuntime, createProjectWorkspace, createRuntimeLLMClient, createRuntimeProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {isAudioInputPath} from '../planning/input.js'
import {createLLMTextDeckProjectPlan} from '../planning/index.js'
import {writeDeckAudioSummaryPlanArtifacts} from './artifacts.js'
import {initializeDeckJob} from './job.js'
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
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })

  await initializeDeckJob(jobStore, {
    inputPath,
    projectId: workspace.projectId,
    stages: DECK_SUMMARIZE_STAGES,
  })
  await agent.startRun('Deck audio summary generation started')
  await agent.startStage('ingest', 'Inspecting source audio')

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

    await agent.completeStage('ingest', 'Source audio inspected')
    await agent.startStage('transcribe', 'Transcribing source audio')

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration: sourceDuration,
      path: inputPath,
    }))
    const transcriptSegments = requireExactTranscriptSegments(transcript, 'Deck audio summary planning')
    const text = requireExactTranscriptText(transcript, 'Deck audio summary planning')

    await agent.completeStage('transcribe', 'Transcription complete')
    await agent.startStage('source-map', 'Building transcript source map')
    await agent.completeStage('source-map', 'Transcript source map prepared')

    const language = options.language ?? requireTranscriptLanguage(transcript, 'Deck audio summary planning')
    const plan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      contentDensity: options.contentDensity,
      deckFormat: options.deckFormat,
      durationTargetSeconds: options.durationTargetSeconds,
	      language,
	      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
	      requiredSlideTypes: options.requiredSlideTypes,
      sourceType: 'audio',
      theme: options.theme,
      title: options.title,
      transcriptSegments,
    }, agent)
    await agent.startStage('timing-preflight', 'Checking script timing')
    await agent.completeStage('timing-preflight', 'Script timing preflight complete')

    const artifacts = await writeDeckAudioSummaryPlanArtifacts(workspace, transcript, plan, llmTrace.path)

    await jobStore.complete('completed')
    await agent.completeRun('Deck audio summary generation complete')
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
    await agent.failRun(tracedError)
    throw tracedError
  }
}

import {probeMedia} from '@video-agent/media'
import {TranscriptSchema} from '@video-agent/providers'
import {resolve} from 'node:path'

import {assertFileExists, createProjectWorkspace, createRuntimeLLMClient, createRuntimeProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {convertDeckSourceAudio} from '../shared/audio.js'
import {createAudioAnchoredDeckProjectPlan, createLLMTextDeckProjectPlan} from '../planning/index.js'
import {writeDeckAudioAnchoredPlanArtifacts} from './artifacts.js'
import {completeDeckJobStages, initializeDeckJob} from './job.js'
import {
	  createDeckJobStore,
	  createProjectLLMTrace,
	  DEFAULT_MAX_SLIDE_CHARACTERS,
	  withLLMTracePath,
	} from './runtime.js'
import type {CreateDeckAudioAnchoredProjectOptions, CreateDeckAudioAnchoredProjectResult} from './types.js'
import {DECK_AUDIO_ANCHORED_STAGES} from '../shared/stages.js'
import {roundSeconds} from '../shared/utils.js'
import {requireExactTranscriptSegments, requireExactTranscriptText, requireTranscriptLanguage} from './transcript.js'

export async function createDeckAudioAnchoredProject(options: CreateDeckAudioAnchoredProjectOptions): Promise<CreateDeckAudioAnchoredProjectResult> {
  const inputPath = resolve(options.inputPath)
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
    stages: DECK_AUDIO_ANCHORED_STAGES,
  })
  await jobStore.updateStage('ingest', 'running', undefined, 1)

  try {
    const outputPath = resolve(workspace.audioDir, 'deck_voiceover.wav')

    await convertDeckSourceAudio(inputPath, outputPath)

    const mediaInfo = await probeMedia(outputPath)
    if (mediaInfo.duration === undefined) {
      throw new Error('Deck audio-anchored planning requires media duration from ffprobe; no default duration fallback is allowed.')
    }

    const duration = mediaInfo.duration
    const config = await readConfig(workspaceDir)
    const llmClient = await createRuntimeLLMClient(config, workspaceDir, {
      llmClient: options.llmClient,
      llmTrace: llmTrace.recorder,
    })

    if (llmClient === undefined) {
      throw new Error('Deck audio-anchored planning requires an LLM provider. Configure an llm block or pass an injected LLM client.')
    }

    const providers = await createRuntimeProviders(config, workspaceDir, {
      llmClient,
      llmTrace: llmTrace.recorder,
    })

    await jobStore.updateStage('ingest', 'completed', undefined, 1)
    await jobStore.updateStage('transcribe', 'running', undefined, 1)

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration,
      path: inputPath,
    }))
    const transcriptSegments = requireExactTranscriptSegments(transcript, 'Deck audio-anchored planning')
    const language = options.language ?? requireTranscriptLanguage(transcript, 'Deck audio-anchored planning')
    const text = requireExactTranscriptText(transcript, 'Deck audio-anchored planning')

    await jobStore.updateStage('transcribe', 'completed', undefined, 1)
    await jobStore.updateStage('plan', 'running', undefined, 1)

    const generatedPlan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      deckFormat: options.deckFormat,
      durationTargetSeconds: duration,
	      language,
	      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
	      requiredSlideTypes: options.requiredSlideTypes,
	      sourceType: 'audio',
      theme: options.theme,
      title: options.title,
      transcriptSegments,
    })
    const plan = createAudioAnchoredDeckProjectPlan(generatedPlan, inputPath, mediaInfo, duration)
    const deckVoiceover = {
      duration,
      generatedAt: new Date().toISOString(),
      outputPath: 'audio/deck_voiceover.wav',
      segments: plan.timedDeck.timings.map((timing, index) => ({
        duration: roundSeconds(timing.end - timing.start),
        narrationId: `narration-${index + 1}`,
        path: 'audio/deck_voiceover.wav',
        slideId: timing.slideId,
        start: timing.start,
      })),
      version: 1 as const,
    }
    const artifacts = await writeDeckAudioAnchoredPlanArtifacts(workspace, transcript, plan, deckVoiceover, llmTrace.path)

    await completeDeckJobStages(jobStore, ['plan', 'align', 'quality'])
    await jobStore.complete('completed')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      duration,
      outputPath,
      projectDir: workspace.projectDir,
      projectId: workspace.projectId,
      slides: plan.deck.slides.length,
      status: 'completed',
    }
  } catch (error) {
    const tracedError = withLLMTracePath(error, llmTrace.path)
    await jobStore.updateStage('transcribe', 'failed', tracedError.message, 1)
    throw tracedError
  }
}

import {probeMedia} from '@video-agent/media'
import {TranscriptSchema} from '@video-agent/providers'
import {resolve} from 'node:path'

import {createProjectAgentRuntime, createProjectWorkspace, createRuntimeLLMClient, createRuntimeProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {convertDeckSourceAudio} from '../shared/audio.js'
import {createAudioAnchoredDeckProjectPlan, createLLMTextDeckProjectPlan} from '../planning/index.js'
import {DECK_STAGE_IDS} from '../pipeline.js'
import {writeDeckAudioAnchoredPlanArtifacts} from './artifacts.js'
import {initializeDeckJob} from './job.js'
import {
	  createDeckJobStore,
	  createProjectLLMTrace,
	  DEFAULT_MAX_SLIDE_CHARACTERS,
	  withLLMTracePath,
	} from './runtime.js'
import type {CreateDeckAudioAnchoredProjectOptions, CreateDeckAudioAnchoredProjectResult} from './types.js'
import {assertFileExists, roundSeconds} from '../shared/utils.js'
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
  const jobStore = await createDeckJobStore({
    projectId: workspace.projectId,
    workspaceDir,
  })
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })

  await initializeDeckJob(jobStore, {
    inputPath,
    projectId: workspace.projectId,
  })
  await agent.startRun('Deck audio-anchored generation started')
  await agent.startStage(DECK_STAGE_IDS.ingest, 'Preparing source audio')

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

    await agent.completeStage(DECK_STAGE_IDS.ingest, 'Source audio prepared')
    await agent.startStage(DECK_STAGE_IDS.transcribe, 'Transcribing source audio')

    const transcript = TranscriptSchema.parse(await providers.asr.transcribe({
      duration,
      path: inputPath,
    }))
    const transcriptSegments = requireExactTranscriptSegments(transcript, 'Deck audio-anchored planning')
    const language = options.language ?? requireTranscriptLanguage(transcript, 'Deck audio-anchored planning')
    const text = requireExactTranscriptText(transcript, 'Deck audio-anchored planning')

    await agent.completeStage(DECK_STAGE_IDS.transcribe, 'Transcription complete')
    await agent.startStage(DECK_STAGE_IDS.sourceMap, 'Building transcript source map')
    await agent.completeStage(DECK_STAGE_IDS.sourceMap, 'Transcript source map prepared')

    const generatedPlan = await createLLMTextDeckProjectPlan(llmClient, inputPath, text, {
      contentDensity: options.contentDensity,
      deckFormat: options.deckFormat,
      durationTargetSeconds: duration,
	      language,
      maxSlideCharacters: options.maxSlideCharacters ?? DEFAULT_MAX_SLIDE_CHARACTERS,
      requiredSlideTypes: options.requiredSlideTypes,
      slideCountMax: options.slideCountMax,
      slideCountTarget: options.slideCountTarget,
      sourceType: 'audio',
      theme: options.theme,
      title: options.title,
      transcriptSegments,
    }, agent)
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

    await agent.startStage(DECK_STAGE_IDS.timingPreflight, 'Checking source-aligned timings')
    await agent.completeStage(DECK_STAGE_IDS.timingPreflight, 'Timing preflight complete')
    await agent.startStage(DECK_STAGE_IDS.align, 'Aligning deck to source audio')
    await agent.completeStage(DECK_STAGE_IDS.align, 'Deck aligned to source audio')
    await agent.skipStage(DECK_STAGE_IDS.synthesizeVoice, 'Audio-anchored deck uses source audio')
    await agent.skipStage(DECK_STAGE_IDS.timingRepair, 'Audio-anchored deck keeps source-aligned timing')
    await agent.completeRun('Deck audio-anchored generation complete')
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
    await agent.failRun(tracedError)
    throw tracedError
  }
}

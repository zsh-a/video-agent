import type {TTSInputSegment} from '@video-agent/providers'

import {DeckSchema, LongVideoSelectedMomentsSchema, MediaInfoSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {join, resolve} from 'node:path'

import {DECK_ARTIFACT_NAME, MEDIA_INFO_ARTIFACT_NAME, SELECTED_MOMENTS_ARTIFACT_NAME, SPEAKER_SCRIPT_ARTIFACT_NAME, STORYBOARD_ARTIFACT_NAME, TIMED_DECK_ARTIFACT_NAME, createProjectAgentRuntime, createProjectWorkspace, createRuntimeProviders, readConfig, refreshArtifactManifest, DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
import {renderDeckVoiceover} from '../shared/audio.js'
import {DECK_STAGE_IDS} from '../pipeline.js'
import {writeDeckVoiceoverProjectArtifacts} from './artifacts.js'
import {initializeDeckJob} from './job.js'
import {createDeckJobStore, createProjectLLMTrace, withLLMTracePath} from './runtime.js'
import type {CreateDeckVoiceoverProjectOptions, CreateDeckVoiceoverProjectResult} from './types.js'
import {createDeckNarrationFromSpeakerScript} from '../planning/timing.js'
import {createDeckVoiceoverUpdate} from './voiceover-update.js'

export async function createDeckVoiceoverProject(options: CreateDeckVoiceoverProjectOptions): Promise<CreateDeckVoiceoverProjectResult> {
  const workspaceDir = resolve(options.workspaceDir ?? DEFAULT_WORKSPACE_DIR)
  const projectId = options.projectId
  const jobStore = await createDeckJobStore({projectId, workspaceDir})
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const llmTrace = createProjectLLMTrace(workspace, options.trace)
  const agent = createProjectAgentRuntime({
    jobStore,
    workspace,
  })

  await initializeDeckJob(jobStore, {
    inputPath: state.inputPath,
    projectId,
  })
  await agent.startRun('Deck voiceover synthesis started')
  await agent.startStage(DECK_STAGE_IDS.synthesizeVoice, 'Synthesizing deck voiceover')

  try {
    const config = await readConfig(workspaceDir)
    const providers = await createRuntimeProviders(config, workspaceDir, {
      llmTrace: llmTrace.recorder,
    })
    const [deck, speakerScript, currentTimedDeck, currentStoryboard, currentSelectedMoments, currentMediaInfo] = await Promise.all([
      DeckSchema.parseAsync(await workspace.store.readJson(DECK_ARTIFACT_NAME)),
      SpeakerScriptSchema.parseAsync(await workspace.store.readJson(SPEAKER_SCRIPT_ARTIFACT_NAME)),
      TimedDeckSchema.parseAsync(await workspace.store.readJson(TIMED_DECK_ARTIFACT_NAME)),
      StoryboardSchema.parseAsync(await workspace.store.readJson(STORYBOARD_ARTIFACT_NAME)),
      LongVideoSelectedMomentsSchema.parseAsync(await workspace.store.readJson(SELECTED_MOMENTS_ARTIFACT_NAME)),
      MediaInfoSchema.parseAsync(await workspace.store.readJson(MEDIA_INFO_ARTIFACT_NAME)),
    ])
    const initialNarration = createDeckNarrationFromSpeakerScript(speakerScript, currentTimedDeck)
    const ttsSegments = TtsSegmentsSchema.parse(await providers.tts.synthesize(createDeckTtsInputSegments(initialNarration), {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    }))
    const voiceoverPath = resolve(workspace.audioDir, 'deck_voiceover.wav')

    await renderDeckVoiceover(workspace.projectDir, ttsSegments, voiceoverPath)
    await agent.completeStage(DECK_STAGE_IDS.synthesizeVoice, 'Deck voiceover audio synthesized')
    await agent.startStage(DECK_STAGE_IDS.timingRepair, 'Repairing deck timing from synthesized voiceover')

    const voiceoverUpdate = createDeckVoiceoverUpdate({
      currentMediaInfo,
      currentSelectedMoments,
      currentStoryboard,
      currentTimedDeck,
      deck,
      speakerScript,
      ttsSegments,
    })
    const artifacts = await writeDeckVoiceoverProjectArtifacts(workspace, {
      deckVoiceover: voiceoverUpdate.deckVoiceover,
      llmTracePath: llmTrace.path,
      mediaInfo: voiceoverUpdate.mediaInfo,
      narration: voiceoverUpdate.narration,
      qualityReport: voiceoverUpdate.qualityReport,
      selectedMoments: voiceoverUpdate.selectedMoments,
      storyboard: voiceoverUpdate.storyboard,
      timingDriftReport: voiceoverUpdate.timingDriftReport,
      timedDeck: voiceoverUpdate.timedDeck,
      timeline: voiceoverUpdate.timeline,
      ttsSegments,
    })

    await agent.completeStage(DECK_STAGE_IDS.timingRepair, 'Deck timing repaired')
    await agent.completeRun('Deck voiceover synthesis complete')
    await refreshArtifactManifest(workspace.artifactsDir)

    return {
      artifacts,
      duration: voiceoverUpdate.totalDuration,
      outputPath: voiceoverPath,
      projectDir: workspace.projectDir,
      projectId,
      slides: deck.slides.length,
      status: 'voiced',
    }
  } catch (error) {
    const tracedError = withLLMTracePath(error, llmTrace.path)
    await agent.failRun(tracedError)
    throw tracedError
  }
}

function createDeckTtsInputSegments(narration: ReturnType<typeof createDeckNarrationFromSpeakerScript>): TTSInputSegment[] {
  return narration.segments.map((segment) => {
    if (segment.duration === undefined || segment.duration <= 0) {
      throw new Error(`Deck narration segment "${segment.id}" must include a positive duration before TTS synthesis.`)
    }

    return {
      duration: segment.duration,
      id: segment.id,
      text: segment.text,
      ...(segment.voice === undefined ? {} : {voice: segment.voice}),
    }
  })
}

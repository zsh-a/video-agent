import type {LongVideoSelectedMoments, MediaInfo} from '@video-agent/ir'

import {DeckSchema, SpeakerScriptSchema, StoryboardSchema, TimedDeckSchema} from '@video-agent/ir'
import {TtsSegmentsSchema} from '@video-agent/providers'
import {join, resolve} from 'node:path'

import {createProjectWorkspace, createRuntimeProviders, readConfig, refreshArtifactManifest} from '@video-agent/runtime'
import {renderDeckVoiceover} from '../shared/audio.js'
import {writeDeckVoiceoverProjectArtifacts} from './artifacts.js'
import {completeDeckJobStages, initializeDeckJob} from './job.js'
import {createDeckJobStore, createProjectLLMTrace, withLLMTracePath} from './runtime.js'
import type {CreateDeckVoiceoverProjectOptions, CreateDeckVoiceoverProjectResult} from './types.js'
import {DECK_STAGES} from '../shared/stages.js'
import {createDeckNarrationFromSpeakerScript} from '../planning/timing.js'
import {createDeckVoiceoverUpdate} from './voiceover-update.js'

export async function createDeckVoiceoverProject(options: CreateDeckVoiceoverProjectOptions): Promise<CreateDeckVoiceoverProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = createDeckJobStore(resolve(workspaceDir, 'projects', projectId))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const llmTrace = createProjectLLMTrace(workspace, options.trace)

  await initializeDeckJob(jobStore, {
    inputPath: state.inputPath,
    projectId,
    stages: DECK_STAGES,
  })
  await jobStore.updateStage('synthesize-voice', 'running', undefined, 1)

  try {
    const config = await readConfig(workspaceDir)
    const providers = await createRuntimeProviders(config, workspaceDir, {
      llmTrace: llmTrace.recorder,
    })
    const [deck, speakerScript, currentTimedDeck, currentStoryboard, currentSelectedMoments, currentMediaInfo] = await Promise.all([
      DeckSchema.parseAsync(await workspace.store.readJson('deck.json')),
      SpeakerScriptSchema.parseAsync(await workspace.store.readJson('speaker-script.json')),
      TimedDeckSchema.parseAsync(await workspace.store.readJson('timed-deck.json')),
      StoryboardSchema.parseAsync(await workspace.store.readJson('storyboard.json')),
      workspace.store.readJson('selected-moments.json') as Promise<LongVideoSelectedMoments>,
      workspace.store.readJson('media-info.json') as Promise<MediaInfo>,
    ])
    const initialNarration = createDeckNarrationFromSpeakerScript(speakerScript, currentTimedDeck)
    const ttsSegments = TtsSegmentsSchema.parse(await providers.tts.synthesize(initialNarration.segments, {
      outputDir: join(workspace.audioDir, 'tts'),
      pathPrefix: 'audio/tts',
    }))
    const voiceoverPath = resolve(workspace.audioDir, 'deck_voiceover.wav')

    await renderDeckVoiceover(workspace.projectDir, ttsSegments, voiceoverPath)

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
      timedDeck: voiceoverUpdate.timedDeck,
      timeline: voiceoverUpdate.timeline,
      ttsSegments,
    })

    await completeDeckJobStages(jobStore, ['synthesize-voice', 'update-timing', 'quality'])
    await jobStore.complete('completed')
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
    await jobStore.updateStage('synthesize-voice', 'failed', tracedError.message, 1)
    throw tracedError
  }
}

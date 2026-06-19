import {
  createDeckAudioAnchoredProject,
  createDeckExplainerProject,
  createDeckFinalRenderProject,
  createDeckSummarizeProject,
  createDeckVoiceoverProject,
} from './deck-project.js'

export {
  DECK_CHECKPOINT_ARTIFACTS_BY_STAGE,
  DECK_PIPELINE_DEFINITION,
  DECK_PIPELINE_STAGES,
} from './pipeline.js'
export type {DeckPipelineStage} from './pipeline.js'

export {
  createDeckAudioAnchoredProject,
  createDeckExplainerProject,
  createDeckFinalRenderProject,
  createDeckFrameShardBatchProject,
  createDeckFrameShardPlanProject,
  createDeckRemotionRenderProject,
  createDeckRendererBackendProject,
  createDeckSummarizeProject,
  createDeckVoiceoverProject,
} from './deck-project.js'

import type {
  CreateDeckAudioAnchoredProjectResult,
  CreateDeckExplainerProjectOptions,
  CreateDeckFinalRenderProjectOptions,
  CreateDeckFinalRenderProjectResult,
  CreateDeckSummarizeProjectResult,
  CreateDeckVoiceoverProjectResult,
} from './deck-project.js'

export type {
  CreateDeckAudioAnchoredProjectOptions,
  CreateDeckAudioAnchoredProjectResult,
  CreateDeckAudioSummaryProjectResult,
  CreateDeckExplainerProjectOptions,
  CreateDeckExplainerProjectResult,
  CreateDeckFinalRenderProjectOptions,
  CreateDeckFinalRenderProjectResult,
  CreateDeckFrameShardBatchProjectOptions,
  CreateDeckFrameShardBatchProjectResult,
  CreateDeckFrameShardPlanProjectOptions,
  CreateDeckFrameShardPlanProjectResult,
  CreateDeckRemotionRenderProjectOptions,
  CreateDeckRemotionRenderProjectResult,
  CreateDeckRendererBackendProjectOptions,
  CreateDeckRendererBackendProjectResult,
  CreateDeckSummarizeProjectOptions,
  CreateDeckSummarizeProjectResult,
  CreateDeckVoiceoverProjectOptions,
  CreateDeckVoiceoverProjectResult,
  DeckRendererBackend,
} from './deck-project.js'

export type DeckExplainerPipelineMode = 'audio-anchored' | 'script-generated' | 'summarize'

export interface RunDeckExplainerPipelineOptions extends Omit<CreateDeckExplainerProjectOptions, 'mode'> {
  chromiumCommand?: CreateDeckFinalRenderProjectOptions['chromiumCommand']
  finalize?: CreateDeckFinalRenderProjectOptions['finalize']
  frameCaptureBackend?: CreateDeckFinalRenderProjectOptions['frameCaptureBackend']
  frameConcurrency?: CreateDeckFinalRenderProjectOptions['frameConcurrency']
  frameEnd?: CreateDeckFinalRenderProjectOptions['frameEnd']
  frameStart?: CreateDeckFinalRenderProjectOptions['frameStart']
  htmlOutput?: CreateDeckFinalRenderProjectOptions['htmlOutput']
  htmlRender?: CreateDeckFinalRenderProjectOptions['htmlRender']
  htmlRenderCommand?: CreateDeckFinalRenderProjectOptions['htmlRenderCommand']
  htmlValidate?: CreateDeckFinalRenderProjectOptions['htmlValidate']
  keyframeCaptureBackend?: CreateDeckFinalRenderProjectOptions['keyframeCaptureBackend']
  mode?: DeckExplainerPipelineMode
  playwrightCommand?: CreateDeckFinalRenderProjectOptions['playwrightCommand']
  renderer?: CreateDeckFinalRenderProjectOptions['renderer']
}

export interface RunDeckExplainerPipelineResult {
  deck: CreateDeckAudioAnchoredProjectResult | CreateDeckSummarizeProjectResult
  finalRender: CreateDeckFinalRenderProjectResult
  projectDir: string
  projectId: string
  status: 'completed'
  voiceover?: CreateDeckVoiceoverProjectResult
}

export async function runDeckExplainerPipeline(options: RunDeckExplainerPipelineOptions): Promise<RunDeckExplainerPipelineResult> {
  const mode = options.mode ?? 'script-generated'
  const deck = mode === 'audio-anchored'
    ? await createDeckAudioAnchoredProject(options)
    : mode === 'summarize'
      ? await createDeckSummarizeProject(options)
      : await createDeckExplainerProject({
          ...options,
          mode: 'script-generated',
        })
  const common = {
    projectId: deck.projectId,
    trace: options.trace,
    workspaceDir: options.workspaceDir,
  }
  const voiceover = mode === 'audio-anchored'
    ? undefined
    : await createDeckVoiceoverProject(common)
  const finalRender = await createDeckFinalRenderProject({
    ...common,
    chromiumCommand: options.chromiumCommand,
    finalize: options.finalize,
    frameCaptureBackend: options.frameCaptureBackend,
    frameConcurrency: options.frameConcurrency,
    frameEnd: options.frameEnd,
    frameStart: options.frameStart,
    htmlOutput: options.htmlOutput,
    htmlRender: options.htmlRender,
    htmlRenderCommand: options.htmlRenderCommand,
    htmlValidate: options.htmlValidate,
    keyframeCaptureBackend: options.keyframeCaptureBackend,
    playwrightCommand: options.playwrightCommand,
    renderer: options.renderer,
  })

  return {
    deck,
    finalRender,
    projectDir: deck.projectDir,
    projectId: deck.projectId,
    status: 'completed',
    voiceover,
  }
}

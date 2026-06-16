import {
  createDeckAudioAnchoredProject,
  createDeckExplainerProject,
  createDeckFinalRenderProject,
  createDeckSummarizeProject,
  createDeckVoiceoverProject,
} from '@video-agent/runtime'

export {
  createDeckAudioAnchoredProject,
  createDeckExplainerProject,
  createDeckFinalRenderProject,
  createDeckSummarizeProject,
  createDeckVoiceoverProject,
} from '@video-agent/runtime'

import type {
  CreateDeckAudioAnchoredProjectResult,
  CreateDeckExplainerProjectOptions,
  CreateDeckFinalRenderProjectOptions,
  CreateDeckFinalRenderProjectResult,
  CreateDeckSummarizeProjectResult,
  CreateDeckVoiceoverProjectResult,
} from '@video-agent/runtime'

export type {
  CreateDeckAudioAnchoredProjectOptions,
  CreateDeckAudioAnchoredProjectResult,
  CreateDeckAudioSummaryProjectResult,
  CreateDeckExplainerProjectOptions,
  CreateDeckFinalRenderProjectOptions,
  CreateDeckFinalRenderProjectResult,
  CreateDeckSummarizeProjectResult,
  CreateDeckVoiceoverProjectOptions,
  CreateDeckVoiceoverProjectResult,
  CreateTextExplainerProjectResult as CreateDeckExplainerProjectResult,
  CreateTextExplainerProjectOptions as CreateDeckSummarizeProjectOptions,
} from '@video-agent/runtime'

export type DeckExplainerPipelineMode = 'audio-anchored' | 'script-generated' | 'summarize'

export interface RunDeckExplainerPipelineOptions extends Omit<CreateDeckExplainerProjectOptions, 'mode'> {
  htmlOutput?: CreateDeckFinalRenderProjectOptions['htmlOutput']
  htmlRender?: CreateDeckFinalRenderProjectOptions['htmlRender']
  htmlRenderCommand?: CreateDeckFinalRenderProjectOptions['htmlRenderCommand']
  htmlValidate?: CreateDeckFinalRenderProjectOptions['htmlValidate']
  mode?: DeckExplainerPipelineMode
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
    workspaceDir: options.workspaceDir,
  }
  const voiceover = mode === 'audio-anchored'
    ? undefined
    : await createDeckVoiceoverProject(common)
  const finalRender = await createDeckFinalRenderProject({
    ...common,
    htmlOutput: options.htmlOutput,
    htmlRender: options.htmlRender,
    htmlRenderCommand: options.htmlRenderCommand,
    htmlValidate: options.htmlValidate,
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

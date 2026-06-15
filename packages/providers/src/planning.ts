import type {LLMClient} from '@video-agent/llm'

import {createNarrationFromClipPlan, createStoryboardFromProviderInsights} from '@video-agent/core'
import {NarrationSchema, StoryboardSchema} from '@video-agent/ir'

import type {ScriptProvider, ScriptProviderInput, StoryboardProvider, StoryboardProviderInput} from './contracts.js'

export class DeterministicStoryboardProvider implements StoryboardProvider {
  async createStoryboard(input: StoryboardProviderInput) {
    return StoryboardSchema.parse(createStoryboardFromProviderInsights(input.mediaInfo, {
      sceneAnalysis: input.sceneAnalysis,
      transcript: input.transcript,
    }))
  }
}

export class DeterministicScriptProvider implements ScriptProvider {
  async createNarration(input: ScriptProviderInput) {
    return NarrationSchema.parse(createNarrationFromClipPlan(input.storyboard, input.clipPlan))
  }
}

export class LLMStoryboardProvider implements StoryboardProvider {
  constructor(private readonly llm: LLMClient) {}

  async createStoryboard(input: StoryboardProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            goal: 'Create concise video storyboard JSON. Return only data that matches the provided schema.',
            instructions: [
              'Create a StoryboardIR for the video.',
              'Use scene IDs from sceneAnalysis or transcript-derived order.',
              'Keep sourceRange within media duration when present.',
              'Use evidence refs transcript.json and scene-analysis.json when useful.',
            ],
            mediaInfo: summarizeMediaInfo(input.mediaInfo),
            sceneAnalysis: input.sceneAnalysis,
            transcript: input.transcript,
          }),
          role: 'user',
        },
      ],
      schema: StoryboardSchema,
      temperature: 0.2,
    })

    return StoryboardSchema.parse(result.object)
  }
}

export class LLMScriptProvider implements ScriptProvider {
  constructor(private readonly llm: LLMClient) {}

  async createNarration(input: ScriptProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            clipPlan: input.clipPlan,
            goal: 'Create narration JSON for a video timeline. Return only data that matches the provided schema.',
            instructions: [
              'Create one narration segment per storyboard scene unless there is a strong reason to split.',
              'Preserve sceneId links.',
              'Keep segment start and duration aligned with clipPlan clips.',
            ],
            storyboard: input.storyboard,
          }),
          role: 'user',
        },
      ],
      schema: NarrationSchema,
      temperature: 0.2,
    })

    return NarrationSchema.parse(result.object)
  }
}

function summarizeMediaInfo(mediaInfo: StoryboardProviderInput['mediaInfo']): Record<string, unknown> {
  return {
    duration: mediaInfo.duration,
    formatName: mediaInfo.formatName,
    inputPath: mediaInfo.inputPath,
    streams: mediaInfo.streams.map((stream) => ({
      duration: stream.duration,
      fps: stream.fps,
      height: stream.height,
      type: stream.type,
      width: stream.width,
    })),
  }
}

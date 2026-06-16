import type {LLMClient} from '@video-agent/llm'

import {createNarrationFromClipPlan, createStoryboardFromProviderInsights} from '@video-agent/core'
import {NarrationSchema, StoryboardSchema, type Storyboard, type StoryboardScene} from '@video-agent/ir'

import type {ScriptProvider, ScriptProviderInput, StoryboardProvider, StoryboardProviderInput} from './contracts.js'

export class DeterministicStoryboardProvider implements StoryboardProvider {
  async createStoryboard(input: StoryboardProviderInput) {
    const selectedMomentsStoryboard = createStoryboardFromSelectedMoments(input)

    if (selectedMomentsStoryboard !== undefined) {
      return StoryboardSchema.parse(selectedMomentsStoryboard)
    }

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
              'When longVideo.selectedMoments is present, build storyboard scenes from those moments first.',
              'Use scene IDs from sceneAnalysis or transcript-derived order.',
              'Keep sourceRange within media duration when present.',
              'Preserve selected moment sourceRange values and evidence refs such as chunks/000/vlm.json when useful.',
              'Use evidence refs transcript.json and scene-analysis.json only when selected moment evidence is unavailable.',
            ],
            longVideo: summarizeLongVideoPlanning(input),
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
              'When longVideo.selectedMoments is present, use the selected moment summaries and evidence as primary script context.',
            ],
            longVideo: summarizeLongVideoPlanning(input),
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

function createStoryboardFromSelectedMoments(input: StoryboardProviderInput): Storyboard | undefined {
  const moments = input.longVideo?.selectedMoments?.moments ?? []

  if (moments.length === 0) {
    return undefined
  }

  let timelineStart = 0
  const sourceDuration = input.mediaInfo.duration
  const scenes = moments.map((moment, index): StoryboardScene => {
    const sourceRange = normalizeSourceRange(moment.sourceRange, sourceDuration)
    const duration = Math.max(sourceRange[1] - sourceRange[0], 0.001)
    const scene: StoryboardScene = {
      duration,
      evidence: moment.evidence,
      id: `scene-${index + 1}`,
      narration: moment.summary,
      sourceRange,
      start: timelineStart,
      visualStyle: 'documentary',
    }

    timelineStart += duration

    return scene
  })

  return {
    language: input.longVideo?.globalOutline?.language ?? input.transcript.language ?? 'zh-CN',
    scenes,
    targetPlatform: 'generic',
    version: 1,
  }
}

function normalizeSourceRange(range: [number, number], sourceDuration: number | undefined): [number, number] {
  let start = Math.max(0, range[0])
  let end = Math.max(start, range[1])

  if (sourceDuration !== undefined && Number.isFinite(sourceDuration) && sourceDuration > 0) {
    start = Math.min(start, sourceDuration)
    end = Math.min(Math.max(end, start), sourceDuration)
  }

  if (end <= start) {
    end = sourceDuration !== undefined && Number.isFinite(sourceDuration) && sourceDuration > start
      ? Math.min(sourceDuration, start + 1)
      : start + 1
  }

  return [start, end]
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

function summarizeLongVideoPlanning(input: {longVideo?: StoryboardProviderInput['longVideo']}): Record<string, unknown> | undefined {
  if (input.longVideo === undefined) {
    return undefined
  }

  return {
    chapters: input.longVideo.chapters,
    chunkCount: input.longVideo.chunkPlan?.chunks.length,
    chunkSummaries: input.longVideo.chunkSummaries,
    globalOutline: input.longVideo.globalOutline,
    selectedMoments: input.longVideo.selectedMoments,
  }
}

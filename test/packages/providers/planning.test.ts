import {expect} from '#test/expect'

import type {LLMClient} from '../../../packages/llm/src/index.js'

import {
  createProviders,
  DeterministicScriptProvider,
  DeterministicStoryboardProvider,
  LLMScriptProvider,
  LLMStoryboardProvider,
} from '../../../packages/providers/src/index.js'

describe('planning providers', () => {
  it('uses deterministic planning providers by default', () => {
    const providers = createProviders({
      providers: {
        asr: 'mock',
        tts: 'mock',
        vlm: 'mock',
      },
    })

    expect(providers.storyboard).to.be.instanceOf(DeterministicStoryboardProvider)
    expect(providers.script).to.be.instanceOf(DeterministicScriptProvider)
  })

  it('uses LLM-backed planning providers when an LLM client is provided', () => {
    const providers = createProviders({
      providers: {
        asr: 'mock',
        tts: 'mock',
        vlm: 'mock',
      },
    }, {
      llmClient: createNoopLlmClient(),
    })

    expect(providers.storyboard).to.be.instanceOf(LLMStoryboardProvider)
    expect(providers.script).to.be.instanceOf(LLMScriptProvider)
  })

  it('creates deterministic slide-explainer storyboard scenes from selected long-video moments', async () => {
    const storyboard = await new DeterministicStoryboardProvider().createStoryboard({
      longVideo: {
        selectedMoments: {
          moments: [
            {
              chunkId: 'chunk-000',
              evidence: [
                {
                  ref: 'chunks/000/vlm.json',
                  text: 'Important visual evidence.',
                  type: 'vlm',
                },
              ],
              id: 'chunk-000-moment-001',
              reason: 'Best visual moment.',
              sourceRange: [5, 8],
              summary: 'Use the selected long-video moment.',
            },
            {
              chunkId: 'chunk-000',
              evidence: [
                {
                  ref: 'chunks/000/transcript.json',
                  text: 'Second teaching point.',
                  type: 'asr',
                },
              ],
              id: 'chunk-000-moment-002',
              reason: 'Next explanation point.',
              sourceRange: [8, 12],
              summary: 'Explain the next long-video point.',
            },
          ],
          source: '/tmp/input.mp4',
          version: 1,
        },
      },
      mediaInfo: {
        duration: 20,
        inputPath: '/tmp/input.mp4',
        probedAt: '2026-06-16T00:00:00.000Z',
        streams: [
          {
            duration: 20,
            fps: 30,
            height: 720,
            type: 'video',
            width: 1280,
          },
        ],
        version: 1,
      },
      sceneAnalysis: [],
      transcript: {
        language: 'en',
        segments: [],
        text: '',
      },
    })

    expect(storyboard.language).to.equal('en')
    expect(storyboard.scenes).to.deep.equal([
      {
        duration: 3,
        evidence: [
          {
            ref: 'chunks/000/vlm.json',
            text: 'Important visual evidence.',
            type: 'vlm',
          },
        ],
        id: 'scene-1',
        narration: 'Use the selected long-video moment.',
        sourceRange: [5, 8],
        start: 0,
        visualStyle: 'slide_explainer',
      },
      {
        duration: 4,
        evidence: [
          {
            ref: 'chunks/000/transcript.json',
            text: 'Second teaching point.',
            type: 'asr',
          },
        ],
        id: 'scene-2',
        narration: 'Explain the next long-video point.',
        sourceRange: [8, 12],
        start: 3,
        visualStyle: 'slide_explainer',
      },
    ])
  })

  it('creates deterministic PPT-style narration text', async () => {
    const narration = await new DeterministicScriptProvider().createNarration({
      clipPlan: {
        clips: [
          {
            duration: 3,
            id: 'clip-1',
            sceneId: 'scene-1',
            source: '/tmp/input.mp4',
            sourceRange: [5, 8],
            start: 0,
          },
        ],
        duration: 3,
        source: '/tmp/input.mp4',
        sourceDuration: 20,
        version: 1,
      },
      storyboard: {
        language: 'zh-CN',
        scenes: [
          {
            duration: 3,
            evidence: [],
            id: 'scene-1',
            narration: '这里讲解第一个关键功能。',
            sourceRange: [5, 8],
            start: 0,
            visualStyle: 'slide_explainer',
          },
        ],
        targetPlatform: 'generic',
        version: 1,
      },
    })

    expect(narration.segments[0]?.text).to.equal('第 1 页：这里讲解第一个关键功能。')
  })
})

function createNoopLlmClient(): LLMClient {
  return {
    async generateObject() {
      throw new Error('Not used by this test.')
    },
    async generateText() {
      throw new Error('Not used by this test.')
    },
    streamText() {
      throw new Error('Not used by this test.')
    },
  }
}

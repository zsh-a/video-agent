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

  it('creates deterministic storyboard scenes from selected long-video moments', async () => {
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
        visualStyle: 'documentary',
      },
    ])
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

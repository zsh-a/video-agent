import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GenerateObjectRequest, GenerateTextRequest, LLMClient, LLMMessage} from '../../../packages/llm/src/index.js'

import {MIMO_PROVIDER_MODEL_IDS, readProviderMetadata} from '../../../packages/providers/src/index.js'
import {createTtsProvider} from '../../../packages/providers/src/registry.js'
import {LLMVLMProvider, MIMO_ASR_MODEL, MIMO_TTS_MODEL, MimoASRProvider, MimoTTSProvider} from '../../../packages/providers/src/llm-media.js'

const asrOptionsKey = 'asr_options'

describe('LLM media providers', () => {
  it('sends sampled scene frames through the LLM VLM provider', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-'))
    const framePath = join(root, 'frame_00001.jpg')
    let request: GenerateObjectRequest<unknown> | undefined

    try {
      await writeFile(framePath, Buffer.from('fake-jpeg'))

      const scenes = await new LLMVLMProvider({
        async generateObject(input) {
          request = input as GenerateObjectRequest<unknown>

          return {
            object: [
              {
                description: 'A generated visual scene.',
                evidence: [framePath],
                sceneId: 'scene-1',
              },
            ],
            usage: {
              inputTokens: 12,
              outputTokens: 4,
              totalTokens: 16,
            },
          }
        },
        async generateText() {
          throw new Error('Not used by this test.')
        },
        streamText() {
          throw new Error('Not used by this test.')
        },
      } satisfies LLMClient).analyzeScenes([
        {
          frames: [framePath],
          sceneId: 'scene-1',
          timeRange: [0, 1],
        },
      ], 'test visual context')

      const message = request?.messages?.[0] as LLMMessage | undefined
      const content = Array.isArray(message?.content) ? message.content : []
      const textPart = content.find((part) => part.type === 'text')
      const imagePart = content.find((part) => part.type === 'file')

      expect(scenes).to.deep.equal([
        {
          description: 'A generated visual scene.',
          evidence: [framePath],
          sceneId: 'scene-1',
        },
      ])
      expect(textPart?.type === 'text' ? JSON.parse(textPart.text) : undefined).to.include({
        context: 'test visual context',
        goal: 'Create visual scene analysis JSON. Return only data matching the schema.',
      })
      expect(imagePart).to.include({
        filename: 'frame_00001.jpg',
        mediaType: 'image/jpeg',
        type: 'file',
      })
      expect(imagePart?.type === 'file' && typeof imagePart.data === 'string' ? imagePart.data : undefined).to.equal('data:image/jpeg;base64,ZmFrZS1qcGVn')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('synthesizes whole-window timestamps when MiMo ASR returns plain text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-'))
    const audioPath = join(root, 'source.wav')
    let request: GenerateTextRequest | undefined

    try {
      await writeText(audioPath, 'fake-audio')

      const transcript = await new MimoASRProvider({
        async generateObject() {
          throw new Error('Not used by this test.')
        },
        async generateText(input) {
          request = input

          return {
            text: '这是中文转写。',
            usage: {
              inputTokens: 8,
              outputTokens: 4,
              totalTokens: 12,
            },
          }
        },
        streamText() {
          throw new Error('Not used by this test.')
        },
      } satisfies LLMClient).transcribe({
        duration: 12.5,
        path: audioPath,
      })
      const metadata = readProviderMetadata(transcript)
      const content = request?.messages?.[0]?.content
      const audioPart = Array.isArray(content) ? content[0] : undefined

      expect(audioPart).to.deep.equal({
        data: 'data:audio/wav;base64,ZmFrZS1hdWRpbw==',
        mediaType: 'audio/wav',
        type: 'file',
      })
      expect(request?.providerOptions).to.deep.equal({
        mimo: {
          [asrOptionsKey]: {
            language: 'auto',
          },
        },
      })
      expect(transcript).to.deep.equal({
        language: 'zh-CN',
        segments: [
          {
            end: 12.5,
            start: 0,
            text: '这是中文转写。',
          },
        ],
        text: '这是中文转写。',
        timestampConfidence: 'chunked',
      })
      expect(metadata).to.deep.equal({
        model: MIMO_ASR_MODEL,
        usage: {
          inputTokens: 8,
          outputTokens: 4,
          totalTokens: 12,
        },
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('segments long MiMo ASR input and merges chunk timestamps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-chunked-'))
    const audioPath = join(root, 'source.wav')
    const texts = ['第一段。', '第二段。', '第三段。']
    const windows: Array<[number, number]> = []

    try {
      await writeText(audioPath, 'source-audio')

      const transcript = await new MimoASRProvider({
        async generateObject() {
          throw new Error('Not used by this test.')
        },
        async generateText() {
          const text = texts.shift() ?? ''

          return {
            text,
            usage: {
              inputTokens: 2,
              outputTokens: 3,
              totalTokens: 5,
            },
          }
        },
        streamText() {
          throw new Error('Not used by this test.')
        },
      } satisfies LLMClient, {
        async segmentAudio(_inputPath, outputPath, window) {
          windows.push([window.start, window.end])
          await writeText(outputPath, `chunk ${window.start}-${window.end}`)
        },
        segmentLengthSeconds: 10,
      }).transcribe({
        duration: 25,
        path: audioPath,
      })
      const metadata = readProviderMetadata(transcript)

      expect(windows).to.deep.equal([[0, 10], [10, 20], [20, 25]])
      expect(transcript).to.deep.equal({
        language: 'zh-CN',
        segments: [
          {
            end: 10,
            start: 0,
            text: '第一段。',
          },
          {
            end: 20,
            start: 10,
            text: '第二段。',
          },
          {
            end: 25,
            start: 20,
            text: '第三段。',
          },
        ],
        text: ['第一段。', '第二段。', '第三段。'].join('\n'),
        timestampConfidence: 'chunked',
      })
      expect(metadata).to.deep.equal({
        model: MIMO_ASR_MODEL,
        usage: {
          inputTokens: 6,
          outputTokens: 9,
          totalTokens: 15,
        },
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('synthesizes MiMo TTS wav files through chat completions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-'))
    const requests: Array<{init?: RequestInit; url: string}> = []
    const fetchMock: typeof fetch = async (input, init) => {
      requests.push({init, url: String(input)})

      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              audio: {
                data: Buffer.from('fake-wav').toString('base64'),
              },
            },
          },
        ],
        id: 'mimo-response-1',
        usage: {
          completion_tokens: 4,
          prompt_tokens: 3,
          total_tokens: 7,
        },
      }), {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'mimo-request-1',
        },
        status: 200,
      })
    }

    try {
      const provider = new MimoTTSProvider({
        apiKey: 'test-key',
        fetch: fetchMock,
        style: '清晰自然地播报。',
        voice: '冰糖',
      })
      const segments = await provider.synthesize([
        {
          duration: 1.5,
          id: 'narration-1',
          start: 0,
          text: '你好世界。',
          voice: '苏打',
        },
      ], {
        outputDir: join(root, 'tts'),
        pathPrefix: 'audio/tts',
      })
      const metadata = readProviderMetadata(segments)
      const body = JSON.parse(String(requests[0]?.init?.body)) as {
        audio: {format: string; voice: string}
        messages: Array<{content: string; role: string}>
        model: string
      }

      expect(requests[0]?.url).to.equal('https://token-plan-cn.xiaomimimo.com/v1/chat/completions')
      expect(requests[0]?.init?.method).to.equal('POST')
      expect(requests[0]?.init?.headers).to.deep.equal({
        'Content-Type': 'application/json',
        'api-key': 'test-key',
      })
      expect(body).to.deep.equal({
        audio: {
          format: 'wav',
          voice: '苏打',
        },
        messages: [
          {
            content: '清晰自然地播报。',
            role: 'user',
          },
          {
            content: '你好世界。',
            role: 'assistant',
          },
        ],
        model: MIMO_TTS_MODEL,
      })
      expect(segments).to.deep.equal([
        {
          duration: 1.5,
          narrationId: 'narration-1',
          path: 'audio/tts/0001-narration-1.wav',
        },
      ])
      expect(await readFile(join(root, 'tts', '0001-narration-1.wav'), 'utf8')).to.equal('fake-wav')
      expect(metadata).to.deep.equal({
        model: MIMO_TTS_MODEL,
        requestId: 'mimo-request-1',
        usage: {
          audioSeconds: 1.5,
          inputCharacters: 5,
          inputTokens: 3,
          outputTokens: 4,
        },
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('selects real MiMo TTS for the Mimo LLM profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-registry-'))
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            audio: {
              data: Buffer.from('registry-wav').toString('base64'),
            },
          },
        },
      ],
    }), {status: 200})

    try {
      const provider = createTtsProvider('llm', {
        env: {
          MIMO_API_KEY: 'docs-style-key',
        },
        fetch: fetchMock,
        llmConfig: {
          apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
          baseURL: 'https://token-plan-cn.xiaomimimo.com/v1',
          model: MIMO_PROVIDER_MODEL_IDS.llm,
          name: 'mimo',
          provider: 'openai-compatible',
        },
      })
      const segments = await provider.synthesize([
        {
          duration: 1,
          id: 'provider-registry-test',
          text: 'Registry test.',
        },
      ], {
        outputDir: join(root, 'tts'),
        pathPrefix: 'audio/tts',
      })

      expect(segments[0]?.path).to.equal('audio/tts/0001-provider-registry-test.wav')
      expect(await readFile(join(root, 'tts', '0001-provider-registry-test.wav'), 'utf8')).to.equal('registry-wav')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

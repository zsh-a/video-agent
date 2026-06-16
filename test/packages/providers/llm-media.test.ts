import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GenerateTextRequest, LLMClient} from '../../../packages/llm/src/index.js'

import {MIMO_PROVIDER_MODEL_IDS, readProviderMetadata} from '../../../packages/providers/src/index.js'
import {createTtsProvider} from '../../../packages/providers/src/registry.js'
import {MIMO_ASR_MODEL, MIMO_TTS_MODEL, MimoASRProvider, MimoTTSProvider} from '../../../packages/providers/src/llm-media.js'

const asrOptionsKey = 'asr_options'

describe('LLM media providers', () => {
  it('transcribes audio through the existing AI SDK LLM client', async () => {
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
      } satisfies LLMClient).transcribe({path: audioPath})
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
            end: 0,
            start: 0,
            text: '这是中文转写。',
          },
        ],
        text: '这是中文转写。',
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

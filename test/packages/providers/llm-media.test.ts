import {expect} from 'chai'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GenerateTextRequest, LLMClient} from '../../../packages/llm/src/index.js'

import {readProviderMetadata} from '../../../packages/providers/src/index.js'
import {MIMO_ASR_MODEL, MimoASRProvider} from '../../../packages/providers/src/llm-media.js'

const asrOptionsKey = 'asr_options'

describe('LLM media providers', () => {
  it('transcribes audio through the existing AI SDK LLM client', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-'))
    const audioPath = join(root, 'source.wav')
    let request: GenerateTextRequest | undefined

    try {
      await writeFile(audioPath, 'fake-audio')

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
        data: Buffer.from('fake-audio'),
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
})

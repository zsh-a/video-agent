import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GenerateObjectRequest, GenerateTextRequest, LLMClient, LLMMessage} from '../../../packages/llm/src/index.js'

import {MIMO_PROVIDER_MODEL_IDS, ProviderExecutionError, ProviderResponseValidationError, readProviderMetadata} from '../../../packages/providers/src/index.js'
import {createTtsProvider} from '../../../packages/providers/src/registry.js'
import {LLMTTSProvider, LLMVLMProvider, MIMO_ASR_MODEL, MIMO_TTS_MODEL, MimoASRProvider, MimoTTSProvider} from '../../../packages/providers/src/llm/media.js'
import {LLMASRProvider} from '../../../packages/providers/src/llm/asr.js'

const asrOptionsKey = 'asr_options'

describe('LLM media providers', () => {
  it('preserves LLM TTS input durations instead of estimating them from text', async () => {
    let request: GenerateObjectRequest<unknown> | undefined

    const ttsSegments = await new LLMTTSProvider({
      async generateObject(input) {
        request = input as GenerateObjectRequest<unknown>

        return {
          object: [
            {
              duration: 2.75,
              narrationId: 'narration-1',
              path: 'llm-tts/narration-1.wav',
            },
          ],
          usage: {
            inputTokens: 7,
            outputTokens: 3,
            totalTokens: 10,
          },
        }
      },
      async generateText() {
        throw new Error('Not used by this test.')
      },
      streamText() {
        throw new Error('Not used by this test.')
      },
    } satisfies LLMClient).synthesize([
      {
        duration: 2.75,
        id: 'narration-1',
        text: 'Narrate the exact planned segment.',
      },
    ])

    const message = request?.messages?.[0]
    const payload = JSON.parse(typeof message?.content === 'string' ? message.content : '{}') as {
      instructions: string[]
      segments: Array<{duration?: number; id: string}>
    }

    expect(payload.instructions.join('\n')).to.include('Do not estimate')
    expect(payload.segments).to.deep.equal([
      {
        duration: 2.75,
        id: 'narration-1',
        text: 'Narrate the exact planned segment.',
      },
    ])
    expect(ttsSegments).to.deep.equal([
      {
        duration: 2.75,
        narrationId: 'narration-1',
        path: 'llm-tts/narration-1.wav',
      },
    ])
    expect(readProviderMetadata(ttsSegments)?.usage).to.deep.include({
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
    })
  })

  it('rejects LLM TTS input without explicit duration instead of estimating by text length', async () => {
    let calls = 0

    let error: unknown

    try {
      await new LLMTTSProvider({
        async generateObject() {
          calls += 1
          throw new Error('Should not ask the LLM when duration is missing.')
        },
        async generateText() {
          throw new Error('Not used by this test.')
        },
        streamText() {
          throw new Error('Not used by this test.')
        },
      } satisfies LLMClient).synthesize([
        {
          id: 'narration-1',
          text: 'Missing duration should fail.',
        },
      ])
    } catch (caught) {
      error = caught
    }

    expect(calls).to.equal(0)
    expect(String(error)).to.include('no text-length duration estimation fallback is allowed')
  })

  it('rejects LLM TTS output that changes requested duration', async () => {
    let error: unknown

    try {
      await new LLMTTSProvider({
        async generateObject() {
          return {
            object: [
              {
                duration: 3.1,
                narrationId: 'narration-1',
                path: 'llm-tts/narration-1.wav',
              },
            ],
          }
        },
        async generateText() {
          throw new Error('Not used by this test.')
        },
        streamText() {
          throw new Error('Not used by this test.')
        },
      } satisfies LLMClient).synthesize([
        {
          duration: 3,
          id: 'narration-1',
          text: 'Duration must stay fixed.',
        },
      ])
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('no duration estimation or reconciliation fallback is allowed')
  })

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
                actions: [],
                characters: [],
                description: 'A generated visual scene.',
                emotions: [],
                evidence: [framePath],
                plotClues: [],
                relationships: [],
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
          actions: [],
          characters: [],
          description: 'A generated visual scene.',
          emotions: [],
          evidence: [framePath],
          plotClues: [],
          relationships: [],
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

  it('keeps VLM image attachments distributed across long scene batches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-long-'))
    const framePaths = Array.from({length: 20}, (_, index) => join(root, `frame_${String(index + 1).padStart(5, '0')}.jpg`))
    let request: GenerateObjectRequest<unknown> | undefined

    try {
      await Promise.all(framePaths.map((framePath, index) => writeFile(framePath, Buffer.from(`fake-jpeg-${index + 1}`))))

      await new LLMVLMProvider({
        async generateObject(input) {
          request = input as GenerateObjectRequest<unknown>

          return {
            object: framePaths.map((framePath, index) => ({
              actions: [],
              characters: [],
              description: `Scene ${index + 1}.`,
              emotions: [],
              evidence: [framePath],
              plotClues: [],
              relationships: [],
              sceneId: `scene-${index + 1}`,
            })),
          }
        },
        async generateText() {
          throw new Error('Not used by this test.')
        },
        streamText() {
          throw new Error('Not used by this test.')
        },
      } satisfies LLMClient).analyzeScenes(framePaths.map((framePath, index) => ({
        frames: [framePath],
        sceneId: `scene-${index + 1}`,
        timeRange: [index, index + 1],
      })))

      const message = request?.messages?.[0] as LLMMessage | undefined
      const content = Array.isArray(message?.content) ? message.content : []
      const textPart = content.find((part) => part.type === 'text')
      const imageParts = content.filter((part) => part.type === 'file')
      const sampledFrames = textPart?.type === 'text' ? JSON.parse(textPart.text).sampledFrames : []

      expect(sampledFrames).to.have.length(16)
      expect(sampledFrames).to.include(framePaths[0])
      expect(sampledFrames).to.include(framePaths.at(-1))
      expect(sampledFrames.some((framePath: string) => framePath.endsWith('frame_00015.jpg') || framePath.endsWith('frame_00016.jpg'))).to.equal(true)
      expect(imageParts).to.have.length(16)
      expect(imageParts.map((part) => part.type === 'file' ? part.filename : '')).to.include('frame_00020.jpg')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects missing VLM frame files instead of analyzing filenames only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-missing-frame-'))
    const framePath = join(root, 'missing-frame.jpg')
    let error: unknown
    let request: GenerateObjectRequest<unknown> | undefined

    try {
      try {
        await new LLMVLMProvider({
          async generateObject(input) {
            request = input as GenerateObjectRequest<unknown>

            return {object: []}
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
        ])
      } catch (caught) {
        error = caught
      }

      expect(request).to.equal(undefined)
      expect(String(error)).to.include('requires readable frame image')
      expect(String(error)).to.include('no path-only visual inference is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

	  it('rejects VLM scene output that omits explicit semantic arrays', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-required-arrays-'))
    const framePath = join(root, 'frame_00001.jpg')

    try {
      await writeFile(framePath, Buffer.from('fake-jpeg'))

      let error: unknown

      try {
        await new LLMVLMProvider({
          async generateObject() {
            return {
              object: [
                {
                  description: 'A generated visual scene.',
                  evidence: [framePath],
                  sceneId: 'scene-1',
                },
              ],
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
        ])
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(Error)
      expect(String(error)).to.include('actions')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
	  })

	  it('rejects blank VLM descriptions and empty evidence before Film uses weak visual semantics', async () => {
	    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-blank-output-'))
	    const framePath = join(root, 'frame_00001.jpg')

	    try {
	      await writeFile(framePath, Buffer.from('fake-jpeg'))
	      let error: unknown

	      try {
	        await new LLMVLMProvider({
	          async generateObject() {
	            return {
	              object: [
	                {
	                  actions: [],
	                  characters: [],
	                  description: '   ',
	                  emotions: [],
	                  evidence: [],
	                  plotClues: [],
	                  relationships: [],
	                  sceneId: 'scene-1',
	                },
	              ],
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
	        ])
	      } catch (error_) {
	        error = error_
	      }

	      expect(error).to.be.instanceOf(ProviderResponseValidationError)
	      expect((error as ProviderResponseValidationError).role).to.equal('vlm')
	      expect((error as ProviderResponseValidationError).issues.map((issue) => issue.path.join('.'))).to.include.members([
	        '0.description',
	        '0.evidence',
	      ])
	    } finally {
	      await rm(root, {force: true, recursive: true})
	    }
	  })

	  it('rejects VLM evidence refs that do not come from the requested scene frame batch', async () => {
	    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-wrong-evidence-'))
	    const framePath = join(root, 'frame_00001.jpg')
	    const otherFramePath = join(root, 'frame_00002.jpg')

	    try {
	      await writeFile(framePath, Buffer.from('fake-jpeg'))
	      let error: unknown

	      try {
	        await new LLMVLMProvider({
	          async generateObject() {
	            return {
	              object: [
	                {
	                  actions: [],
	                  characters: [],
	                  description: 'A generated visual scene.',
	                  emotions: [],
	                  evidence: [otherFramePath],
	                  plotClues: [],
	                  relationships: [],
	                  sceneId: 'scene-1',
	                },
	              ],
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
	        ])
	      } catch (error_) {
	        error = error_
	      }

	      expect(error).to.be.instanceOf(ProviderResponseValidationError)
	      expect((error as Error).message).to.include('no VLM evidence remapping fallback is allowed')
	      expect((error as ProviderResponseValidationError).issues[0]?.code).to.equal('vlm_evidence_frame_mismatch')
	    } finally {
	      await rm(root, {force: true, recursive: true})
	    }
	  })

	  it('sends attached audio to generic LLM ASR instead of asking for path-based transcript inference', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-llm-asr-audio-'))
    const audioPath = join(root, 'source.wav')
    let request: GenerateObjectRequest<unknown> | undefined

    try {
      await writeText(audioPath, 'fake-audio')

      const transcript = await new LLMASRProvider({
        async generateObject(input) {
          request = input as GenerateObjectRequest<unknown>

          return {
            object: {
              language: 'en-US',
              segments: [
                {
                  end: 1,
                  start: 0,
                  text: 'Attached audio transcript.',
                },
              ],
              text: 'Attached audio transcript.',
              timestampConfidence: 'exact',
            },
          }
        },
        async generateText() {
          throw new Error('Not used by this test.')
        },
        streamText() {
          throw new Error('Not used by this test.')
        },
      } satisfies LLMClient).transcribe({
        duration: 1,
        path: audioPath,
      })

      const message = request?.messages?.[0] as LLMMessage | undefined
      const content = Array.isArray(message?.content) ? message.content : []
      const textPart = content.find((part) => part.type === 'text')
      const audioPart = content.find((part) => part.type === 'file')
      const prompt = textPart?.type === 'text' ? JSON.parse(textPart.text) as {instructions: string[]} : undefined

      expect(transcript).to.deep.equal({
        language: 'en-US',
        segments: [
          {
            end: 1,
            start: 0,
            text: 'Attached audio transcript.',
          },
        ],
        text: 'Attached audio transcript.',
        timestampConfidence: 'exact',
      })
      expect(prompt?.instructions.join('\n')).to.include('Use the attached audio file as the only speech evidence')
      expect(prompt?.instructions.join('\n')).to.include('Do not infer, summarize, or invent transcript text from the file path')
      expect(audioPart).to.include({
        mediaType: 'audio/wav',
        type: 'file',
      })
      expect(audioPart?.type === 'file' && audioPart.data).to.equal('data:audio/wav;base64,ZmFrZS1hdWRpbw==')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects generic LLM ASR output without exact timed transcript evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-llm-asr-no-timing-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new LLMASRProvider({
          async generateObject() {
            return {
              object: {
                language: 'en-US',
                segments: [],
                text: 'Path-derived transcript.',
              },
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 1,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('LLM ASR transcript must provide exact timestamps')
      expect(String(error)).to.include('received missing')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects generic LLM ASR segments without explicit transcript text instead of reconstructing it locally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-llm-asr-no-text-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new LLMASRProvider({
          async generateObject() {
            return {
              object: {
                language: 'en-US',
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: 'Explicit segment text.',
                  },
                ],
                text: '',
                timestampConfidence: 'exact',
              },
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 1,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no segment-text transcript reconstruction fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects generic LLM ASR transcript text trim instead of rewriting provider evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-llm-asr-trim-text-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new LLMASRProvider({
          async generateObject() {
            return {
              object: {
                language: 'en-US',
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: 'Explicit segment text.',
                  },
                ],
                text: ' Explicit transcript text.',
                timestampConfidence: 'exact',
              },
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 1,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no runtime transcript text trim is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects generic LLM ASR segment text trim instead of rewriting timed evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-llm-asr-trim-segment-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new LLMASRProvider({
          async generateObject() {
            return {
              object: {
                language: 'en-US',
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: ' Explicit segment text.',
                  },
                ],
                text: 'Explicit segment text.',
                timestampConfidence: 'exact',
              },
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 1,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no runtime transcript segment text trim is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects generic LLM ASR non-concrete language tags instead of treating auto as explicit language', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-llm-asr-auto-language-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new LLMASRProvider({
          async generateObject() {
            return {
              object: {
                language: 'auto',
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: 'Explicit segment text.',
                  },
                ],
                text: 'Explicit segment text.',
                timestampConfidence: 'exact',
              },
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 1,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('language "auto" is not a concrete language tag')
      expect(String(error)).to.include('no language default fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects MiMo ASR plain text instead of assigning fallback chunk timestamps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-'))
    const audioPath = join(root, 'source.wav')
    let request: GenerateTextRequest | undefined
    let languageRequest: GenerateObjectRequest<unknown> | undefined
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new MimoASRProvider({
          async generateObject(input) {
            languageRequest = input as GenerateObjectRequest<unknown>

            return {
              object: {language: 'zh-CN'},
              usage: {
                inputTokens: 3,
                outputTokens: 1,
                totalTokens: 4,
              },
            }
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
      } catch (caught) {
        error = caught
      }

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
      expect(languageRequest).to.equal(undefined)
      expect(String(error)).to.include('MiMo ASR must return transcript JSON with timed segments')
      expect(String(error)).to.include('plain text ASR output cannot be converted')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects MiMo ASR language detection output that is not a concrete language tag', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-unknown-language-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            return {
              object: {language: 'unknown'},
            }
          },
          async generateText() {
            return {
              text: JSON.stringify({
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: 'Language must be detected concretely.',
                  },
                ],
                text: 'Language must be detected concretely.',
              }),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 12.5,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('language "unknown" is not a concrete language tag')
      expect(String(error)).to.include('no language default fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects MiMo ASR transcript JSON without timed segments instead of creating a full-window segment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-no-segments-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language normalization should not run for invalid transcript timing.')
          },
          async generateText() {
            return {
              text: JSON.stringify({
                language: 'en-US',
                segments: [],
                text: 'Transcript text without segment timing.',
              }),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 12.5,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('contains text but no timed segments')
      expect(String(error)).to.include('no default timing fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects MiMo ASR timed segments without explicit transcript text instead of reconstructing it locally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-no-text-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language normalization should not run when transcript text is missing.')
          },
          async generateText() {
            return {
              text: JSON.stringify({
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: '这是中文转写。',
                  },
                ],
                text: '',
              }),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 12.5,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no segment-text transcript reconstruction fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects MiMo ASR transcript text trim instead of rewriting provider JSON evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-trim-text-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language normalization should not run for invalid transcript text.')
          },
          async generateText() {
            return {
              text: JSON.stringify({
                language: 'zh-CN',
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: '这是中文转写。',
                  },
                ],
                text: '这是中文转写。 ',
              }),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 12.5,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no runtime transcript text trim is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects MiMo ASR segment text trim instead of rewriting timed JSON evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-trim-segment-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language normalization should not run for invalid segment text.')
          },
          async generateText() {
            return {
              text: JSON.stringify({
                language: 'zh-CN',
                segments: [
                  {
                    end: 1,
                    start: 0,
                    text: ' 这是中文转写。',
                  },
                ],
                text: '这是中文转写。',
              }),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 12.5,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no runtime transcript segment text trim is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects fenced MiMo ASR transcript JSON instead of extracting it locally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-fenced-json-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'fake-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language normalization should not run for invalid transcript JSON framing.')
          },
          async generateText() {
            return {
              text: [
                '```json',
                JSON.stringify({
                  language: 'zh-CN',
                  segments: [{end: 1, start: 0, text: '这是中文转写。'}],
                  text: '这是中文转写。',
                }),
                '```',
              ].join('\n'),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient).transcribe({
          duration: 12.5,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('MiMo ASR must return transcript JSON with timed segments')
      expect(String(error)).to.include('plain text ASR output cannot be converted')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('segments long MiMo ASR input and merges exact JSON chunk timestamps', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-chunked-'))
    const audioPath = join(root, 'source.wav')
    const transcripts = [
      {
        language: 'zh-CN',
        segments: [{end: 9, start: 0, text: '第一段。'}],
        text: '第一段。',
      },
      {
        language: 'zh-CN',
        segments: [{end: 8, start: 0, text: '第二段。'}],
        text: '第二段。',
      },
      {
        language: 'zh-CN',
        segments: [{end: 4, start: 0, text: '第三段。'}],
        text: '第三段。',
      },
    ]
    const windows: Array<[number, number]> = []

    try {
      await writeText(audioPath, 'source-audio')

      const transcript = await new MimoASRProvider({
        async generateObject() {
          return {
            object: {language: 'zh-CN'},
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              totalTokens: 2,
            },
          }
        },
        async generateText() {
          const transcript = transcripts.shift()

          return {
            text: JSON.stringify(transcript),
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
            end: 9,
            start: 0,
            text: '第一段。',
          },
          {
            end: 18,
            start: 10,
            text: '第二段。',
          },
          {
            end: 24,
            start: 20,
            text: '第三段。',
          },
        ],
        text: ['第一段。', '第二段。', '第三段。'].join('\n'),
        timestampConfidence: 'exact',
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

  it('rejects MiMo ASR chunk timestamps outside the local audio window instead of guessing absolute timing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-absolute-chunk-'))
    const audioPath = join(root, 'source.wav')
    const transcripts = [
      {
        language: 'zh-CN',
        segments: [{end: 4, start: 0, text: '第一段。'}],
        text: '第一段。',
      },
      {
        language: 'zh-CN',
        segments: [{end: 14, start: 10, text: '第二段。'}],
        text: '第二段。',
      },
    ]
    let error: unknown

    try {
      await writeText(audioPath, 'source-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language detection should not run when chunks already include language.')
          },
          async generateText() {
            const transcript = transcripts.shift()

            return {
              text: JSON.stringify(transcript),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient, {
          async segmentAudio(_inputPath, outputPath, window) {
            await writeText(outputPath, `chunk ${window.start}-${window.end}`)
          },
          segmentLengthSeconds: 10,
        }).transcribe({
          duration: 20,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no absolute/global timestamp fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects MiMo ASR chunk transcript text trim instead of rewriting merged transcript evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-chunk-trim-text-'))
    const audioPath = join(root, 'source.wav')
    const transcripts = [
      {
        language: 'zh-CN',
        segments: [{end: 4, start: 0, text: '第一段。'}],
        text: '第一段。',
      },
      {
        language: 'zh-CN',
        segments: [{end: 4, start: 0, text: '第二段。'}],
        text: ' 第二段。',
      },
    ]

    try {
      await writeText(audioPath, 'source-audio')

      let error: unknown

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language detection should not run when chunks already include language.')
          },
          async generateText() {
            const transcript = transcripts.shift()

            return {
              text: JSON.stringify(transcript),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient, {
          async segmentAudio(_inputPath, outputPath, window) {
            await writeText(outputPath, `chunk ${window.start}-${window.end}`)
          },
          segmentLengthSeconds: 10,
        }).transcribe({
          duration: 20,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('no runtime transcript text trim is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects conflicting MiMo ASR chunk languages instead of keeping the first language', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-language-conflict-'))
    const audioPath = join(root, 'source.wav')
    const transcripts = [
      {
        language: 'zh-CN',
        segments: [{end: 4, start: 0, text: '第一段。'}],
        text: '第一段。',
      },
      {
        language: 'en-US',
        segments: [{end: 4, start: 0, text: 'Second segment.'}],
        text: 'Second segment.',
      },
    ]

    try {
      await writeText(audioPath, 'source-audio')

      let error: unknown

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Language detection should not run when chunks already include languages.')
          },
          async generateText() {
            const transcript = transcripts.shift()

            return {
              text: JSON.stringify(transcript),
            }
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient, {
          async segmentAudio(_inputPath, outputPath, window) {
            await writeText(outputPath, `chunk ${window.start}-${window.end}`)
          },
          segmentLengthSeconds: 10,
        }).transcribe({
          duration: 20,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('conflicting languages')
      expect(String(error)).to.include('no merged transcript language fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails MiMo ASR segmentation errors instead of inserting empty transcript windows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-asr-segment-fail-'))
    const audioPath = join(root, 'source.wav')
    let error: unknown

    try {
      await writeText(audioPath, 'source-audio')

      try {
        await new MimoASRProvider({
          async generateObject() {
            throw new Error('Not used by this test.')
          },
          async generateText() {
            throw new Error('ASR should not run when segmentation fails.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient, {
          async segmentAudio() {
            throw new Error('ffmpeg segment failed')
          },
          segmentLengthSeconds: 10,
        }).transcribe({
          duration: 25,
          path: audioPath,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('MiMo ASR failed to prepare audio segment 1')
      expect(String(error)).to.include('ffmpeg segment failed')
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
                data: createSilentWavBase64(1.5),
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
      expect(segments[0]).to.deep.include({
        narrationId: 'narration-1',
        path: 'audio/tts/0001-narration-1.wav',
      })
      expect(Math.abs((segments[0]?.duration ?? 0) - 1.5)).to.be.lessThan(0.01)
      expect((await readFile(join(root, 'tts', '0001-narration-1.wav'))).subarray(0, 4).toString('ascii')).to.equal('RIFF')
      expect(metadata).to.deep.equal({
        model: MIMO_TTS_MODEL,
        requestId: 'mimo-request-1',
        usage: {
          audioSeconds: segments[0]?.duration,
          inputCharacters: 5,
          inputTokens: 3,
          outputTokens: 4,
        },
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('retries retryable MiMo TTS HTTP failures before writing audio', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-retry-'))
    const responses = [
      new Response('rate limited', {status: 429}),
      new Response(JSON.stringify({
        choices: [
          {
            message: {
              audio: {
                data: createSilentWavBase64(1),
              },
            },
          },
        ],
      }), {status: 200}),
    ]
    const fetchMock: typeof fetch = async () => responses.shift() ?? new Response('unexpected', {status: 500})

    try {
      const provider = new MimoTTSProvider({
        apiKey: 'test-key',
        fetch: fetchMock,
        maxRetries: 1,
        retryBackoffMs: 0,
      })
      const segments = await provider.synthesize([
        {
          duration: 1,
          id: 'narration-1',
          start: 0,
          text: 'Retry test.',
        },
      ], {
        outputDir: join(root, 'tts'),
      })

      expect(segments[0]?.path).to.equal(join(root, 'tts', '0001-narration-1.wav'))
      expect((await readFile(join(root, 'tts', '0001-narration-1.wav'))).subarray(0, 4).toString('ascii')).to.equal('RIFF')
      expect(responses).to.have.length(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('surfaces non-retryable MiMo TTS failures as structured provider errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-error-'))
    const fetchMock: typeof fetch = async () => new Response('bad request', {
      headers: {
        'x-request-id': 'mimo-bad-request',
      },
      status: 400,
    })
    let error: unknown

    try {
      const provider = new MimoTTSProvider({
        apiKey: 'test-key',
        fetch: fetchMock,
        maxRetries: 2,
        retryBackoffMs: 0,
      })

      await provider.synthesize([
        {
          duration: 1,
          id: 'narration-1',
          start: 0,
          text: 'Bad request test.',
        },
      ], {
        outputDir: join(root, 'tts'),
      })
    } catch (error_) {
      error = error_
    } finally {
      await rm(root, {force: true, recursive: true})
    }

    expect(error).to.be.instanceOf(ProviderExecutionError)
    expect(error).to.deep.include({
      code: 'mimo_tts_http_error',
      retryable: false,
      role: 'tts',
    })
    expect((error as ProviderExecutionError).details).to.deep.include({
      requestId: 'mimo-bad-request',
      responseBody: 'bad request',
      status: 400,
    })
  })

  it('rejects MiMo TTS audio that cannot be probed instead of using requested duration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-invalid-audio-'))
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            audio: {
              data: Buffer.from('not-a-wav').toString('base64'),
            },
          },
        },
      ],
    }), {status: 200})
    let error: unknown

    try {
      const provider = new MimoTTSProvider({
        apiKey: 'test-key',
        fetch: fetchMock,
      })

      await provider.synthesize([
        {
          duration: 1,
          id: 'narration-1',
          start: 0,
          text: 'Invalid audio test.',
        },
      ], {
        outputDir: join(root, 'tts'),
      })
    } catch (error_) {
      error = error_
    } finally {
      await rm(root, {force: true, recursive: true})
    }

    expect(error).to.be.instanceOf(ProviderExecutionError)
    expect(error).to.deep.include({
      code: 'mimo_tts_invalid_audio',
      role: 'tts',
    })
  })

  it('passes explicit MiMo TTS voice hints through instead of keyword-mapping them to the configured default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-voice-'))
    const requests: Array<{init?: RequestInit; url: string}> = []
    const fetchMock: typeof fetch = async (input, init) => {
      requests.push({init, url: String(input)})

      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              audio: {
                data: createSilentWavBase64(1),
              },
            },
          },
        ],
      }), {status: 200})
    }

    try {
      const provider = new MimoTTSProvider({
        apiKey: 'test-key',
        fetch: fetchMock,
        voice: '冰糖',
      })

      await provider.synthesize([
        {
          id: 'narration-1',
          text: '你好世界。',
          voice: 'male',
        },
      ], {
        outputDir: join(root, 'tts'),
      })

      const body = JSON.parse(String(requests[0]?.init?.body)) as {
        audio: {format: string; voice: string}
      }

      expect(body.audio).to.deep.equal({
        format: 'wav',
        voice: 'male',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects blank MiMo TTS segment voice instead of falling back to the configured default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-blank-voice-'))
    let calls = 0
    const fetchMock: typeof fetch = async () => {
      calls += 1

      return new Response(JSON.stringify({}), {status: 500})
    }
    let error: unknown

    try {
      const provider = new MimoTTSProvider({
        apiKey: 'test-key',
        fetch: fetchMock,
        voice: '冰糖',
      })

      await provider.synthesize([
        {
          id: 'narration-1',
          text: '你好世界。',
          voice: '   ',
        },
      ], {
        outputDir: join(root, 'tts'),
      })
    } catch (caught) {
      error = caught
    } finally {
      await rm(root, {force: true, recursive: true})
    }

    expect(calls).to.equal(0)
    expect(String(error)).to.include('no default voice fallback is allowed')
  })

  it('rejects MiMo TTS segment voice whitespace instead of trimming it locally', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-trim-voice-'))
    let calls = 0
    const fetchMock: typeof fetch = async () => {
      calls += 1

      return new Response(JSON.stringify({}), {status: 500})
    }
    let error: unknown

    try {
      const provider = new MimoTTSProvider({
        apiKey: 'test-key',
        fetch: fetchMock,
        voice: '冰糖',
      })

      await provider.synthesize([
        {
          id: 'narration-1',
          text: '你好世界。',
          voice: ' 苏打 ',
        },
      ], {
        outputDir: join(root, 'tts'),
      })
    } catch (caught) {
      error = caught
    } finally {
      await rm(root, {force: true, recursive: true})
    }

    expect(calls).to.equal(0)
    expect(String(error)).to.include('no runtime voice whitespace cleanup is allowed')
  })

  it('selects real MiMo TTS for the Mimo LLM profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mimo-tts-registry-'))
    const fetchMock: typeof fetch = async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            audio: {
              data: createSilentWavBase64(1),
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
      expect((await readFile(join(root, 'tts', '0001-provider-registry-test.wav'))).subarray(0, 4).toString('ascii')).to.equal('RIFF')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

function createSilentWavBase64(durationSeconds: number): string {
  return createSilentWav(durationSeconds).toString('base64')
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 24_000
  const channels = 1
  const bytesPerSample = 2
  const frameCount = Math.max(1, Math.round(Math.max(durationSeconds, 0.1) * sampleRate))
  const dataSize = frameCount * channels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
}

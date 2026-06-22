import type {ASRProvider, MediaInput, SceneFrameBatch, Transcript, TTSInputSegment, TTSProvider, TTSSegment, TTSProviderSynthesizeOptions, VLMProvider, VLMScene} from './contracts.js'

import {Buffer} from 'node:buffer'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, posix} from 'node:path'

import {SceneFrameBatchesSchema} from './schemas.js'

const MOCK_TTS_SAMPLE_RATE = 24_000

export class MockASRProvider implements ASRProvider {
  async transcribe(input: MediaInput): Promise<Transcript> {
    const duration = input.duration !== undefined && Number.isFinite(input.duration) && input.duration > 0 ? input.duration : 1

    return {
      language: 'zh-CN',
      segments: [
        {
          end: duration,
          start: 0,
          text: `Mock transcript for ${input.path}.`,
        },
      ],
      text: `Mock transcript for ${input.path}.`,
      timestampConfidence: 'exact',
    }
  }
}

export class MockTTSProvider implements TTSProvider {
  async synthesize(segments: TTSInputSegment[], options: TTSProviderSynthesizeOptions = {}): Promise<TTSSegment[]> {
    if (options.outputDir !== undefined) {
      await mkdir(options.outputDir, {recursive: true})
    }

    const results = segments.map((segment, index) => {
      const duration = requireMockTtsDuration(segment)
      const filename = `${String(index + 1).padStart(4, '0')}-${sanitizeFilename(segment.id)}.wav`
      const outputPath = options.outputDir === undefined ? undefined : join(options.outputDir, filename)
      const path = outputPath === undefined
        ? options.pathPrefix === undefined ? `mock-tts/${segment.id}.wav` : posix.join(options.pathPrefix, filename)
        : options.pathPrefix === undefined ? outputPath : posix.join(options.pathPrefix, filename)

      return {
        outputPath,
        segment: {
          duration,
          narrationId: segment.id,
          path,
        },
      }
    })

    await Promise.all(results.map(async (result) => {
      if (result.outputPath !== undefined) {
        await writeFile(result.outputPath, createSilentWav(result.segment.duration))
      }
    }))

    return results.map((result) => result.segment)
  }
}

function requireMockTtsDuration(segment: TTSInputSegment): number {
  if (!Number.isFinite(segment.duration) || segment.duration <= 0) {
    throw new Error(`Mock TTS segment "${segment.id}" must include a positive finite duration; no synthetic mock audio duration fallback is allowed. Received: ${String(segment.duration)}`)
  }

  if (Math.round(segment.duration * MOCK_TTS_SAMPLE_RATE) < 1) {
    throw new Error(`Mock TTS segment "${segment.id}" duration is too short to produce one WAV frame; no single-frame mock audio fallback is allowed. Received: ${String(segment.duration)}`)
  }

  return segment.duration
}

export class MockVLMProvider implements VLMProvider {
  async analyzeScenes(input: SceneFrameBatch[]): Promise<VLMScene[]> {
    const batches = SceneFrameBatchesSchema.parse(input)

    return batches.map((batch) => ({
      actions: [],
      characters: [],
      description: `Mock visual analysis for ${batch.sceneId}.`,
      emotions: [],
      evidence: batch.frames,
      plotClues: [],
      relationships: [],
      sceneId: batch.sceneId,
    }))
  }
}

function sanitizeFilename(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

  return sanitized.length === 0 ? 'segment' : sanitized
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = MOCK_TTS_SAMPLE_RATE
  const channels = 1
  const bytesPerSample = 2
  const frameCount = Math.round(durationSeconds * sampleRate)
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

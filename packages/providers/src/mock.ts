import type {ASRProvider, MediaInput, SceneFrameBatch, Transcript, TTSProvider, TTSSegment, VLMProvider, VLMScene} from './contracts.js'

export class MockASRProvider implements ASRProvider {
  async transcribe(input: MediaInput): Promise<Transcript> {
    return {
      language: 'zh-CN',
      segments: [
        {
          end: 0,
          start: 0,
          text: `Mock transcript for ${input.path}.`,
        },
      ],
      text: `Mock transcript for ${input.path}.`,
    }
  }
}

export class MockTTSProvider implements TTSProvider {
  async synthesize(segments: {duration?: number; id: string}[]): Promise<TTSSegment[]> {
    return segments.map((segment) => ({
      duration: segment.duration ?? 0,
      narrationId: segment.id,
      path: `mock-tts/${segment.id}.wav`,
    }))
  }
}

export class MockVLMProvider implements VLMProvider {
  async analyzeScenes(input: SceneFrameBatch[]): Promise<VLMScene[]> {
    return input.map((batch) => ({
      description: `Mock visual analysis for ${batch.sceneId}.`,
      evidence: batch.frames,
      sceneId: batch.sceneId,
    }))
  }
}

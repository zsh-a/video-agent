interface ProviderEnvelope {
  data: unknown
  metadata: {
    model: string
    requestId: string
    usage: Record<string, number>
  }
}

const payload = parsePayload(await Bun.stdin.text())
const kind = typeof payload.kind === 'string' ? payload.kind : 'unknown'

switch (kind) {
  case 'asr': {
    emit({
      language: 'en',
      segments: [
        {
          end: 1,
          speaker: 'example',
          start: 0,
          text: `Example transcript for ${readInputPath(payload)}`,
        },
      ],
      text: `Example transcript for ${readInputPath(payload)}`,
    }, {
      audioSeconds: 1,
      outputCharacters: 42,
    })
    break
  }

  case 'tts': {
    const segments = readNarrationSegments(payload)

    emit(segments.map((segment) => ({
      duration: segment.duration,
      narrationId: segment.id,
      path: `tts/${segment.id}.wav`,
    })), {
      inputCharacters: segments.reduce((count, segment) => count + segment.text.length, 0),
    })
    break
  }

  case 'vlm': {
    const scenes = readSceneBatches(payload)

    emit(scenes.map((scene) => ({
      actions: [],
      characters: [],
      description: `Example visual analysis for ${scene.sceneId}`,
      emotions: [],
      evidence: scene.frames,
      plotClues: [],
      relationships: [],
      sceneId: scene.sceneId,
    })), {
      inputImages: scenes.reduce((count, scene) => count + scene.frames.length, 0),
    })
    break
  }

  default: {
    throw new Error(`Unsupported provider kind: ${kind}`)
  }
}

function emit(data: unknown, usage: Record<string, number>): void {
  const envelope: ProviderEnvelope = {
    data,
    metadata: {
      model: 'example-command-provider',
      requestId: `example-${kind}`,
      usage,
    },
  }

  console.log(JSON.stringify(envelope))
}

function parsePayload(text: string): Record<string, unknown> {
  const value = JSON.parse(text) as unknown

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Provider payload must be a JSON object.')
  }

  return value as Record<string, unknown>
}

function readInputPath(value: Record<string, unknown>): string {
  const {input} = value

  return isRecord(input) && typeof input.path === 'string' ? input.path : 'unknown-input'
}

function readSceneBatches(value: Record<string, unknown>): Array<{frames: string[]; sceneId: string}> {
  const input = Array.isArray(value.input) ? value.input : []

  return input.map((scene, index) => {
    if (!isRecord(scene)) {
      return {
        frames: [],
        sceneId: `scene-${index + 1}`,
      }
    }

    return {
      frames: Array.isArray(scene.frames) ? scene.frames.filter((frame): frame is string => typeof frame === 'string') : [],
      sceneId: typeof scene.sceneId === 'string' ? scene.sceneId : `scene-${index + 1}`,
    }
  })
}

function readNarrationSegments(value: Record<string, unknown>): Array<{duration: number; id: string; text: string}> {
  const segments = Array.isArray(value.segments) ? value.segments : []

  return segments.map((segment, index) => {
    if (!isRecord(segment)) {
      return {
        duration: 1,
        id: `narration-${index + 1}`,
        text: '',
      }
    }

    return {
      duration: typeof segment.duration === 'number' ? segment.duration : 1,
      id: typeof segment.id === 'string' ? segment.id : `narration-${index + 1}`,
      text: typeof segment.text === 'string' ? segment.text : '',
    }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

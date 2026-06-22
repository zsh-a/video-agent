import {expect} from '#test/expect'

import {CommandASRProvider, CommandTTSProvider, CommandVLMProvider, createAsrProvider, ProviderExecutionError, ProviderResponseValidationError, readProviderMetadata} from '../../../packages/providers/src/index.js'

describe('command providers', () => {
  it('runs an ASR command provider over JSON stdin/stdout', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand('{"text":"command transcript","segments":[{"start":0,"end":1,"text":"command transcript"}],"timestampConfidence":"exact"}'),
    })

    const transcript = await provider.transcribe({path: '/tmp/audio.wav'})

    expect(transcript.text).to.equal('command transcript')
    expect(transcript.segments[0].start).to.equal(0)
  })

  it('preserves provider response metadata from command envelopes', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand(
        '{"data":{"text":"command transcript","segments":[{"start":0,"end":1,"text":"command transcript"}],"timestampConfidence":"exact"},"metadata":{"cost":{"amount":0.01,"currency":"USD","estimated":true},"model":"asr-test","requestId":"req-1","usage":{"audioSeconds":1,"outputCharacters":18}}}',
      ),
    })

    const transcript = await provider.transcribe({path: '/tmp/audio.wav'})

    expect(readProviderMetadata(transcript)).to.deep.equal({
      cost: {
        amount: 0.01,
        currency: 'USD',
        estimated: true,
      },
      model: 'asr-test',
      requestId: 'req-1',
      usage: {
        audioSeconds: 1,
        outputCharacters: 18,
      },
    })
  })

  it('rejects invalid provider response metadata instead of silently dropping fields', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand(
        '{"data":{"text":"command transcript","segments":[{"start":0,"end":1,"text":"command transcript"}],"timestampConfidence":"exact"},"metadata":{"model":123,"usage":{"inputTokens":-1}}}',
      ),
    })
    let error: unknown

    try {
      await provider.transcribe({path: '/tmp/audio.wav'})
    } catch (caught) {
      error = caught
    }

    expect(error).to.be.instanceOf(ProviderResponseValidationError)
    expect(String(error)).to.include('invalid response metadata')
    expect(String(error)).to.include('no metadata field omission fallback is allowed')
  })

  it('runs a VLM command provider over JSON stdin/stdout', async () => {
    const provider = new CommandVLMProvider({
      command: jsonCommand('[{"actions":[],"characters":[],"sceneId":"scene-1","description":"scene scene-1","emotions":[],"evidence":["frame.jpg"],"plotClues":[],"relationships":[]}]'),
    })

    const scenes = await provider.analyzeScenes([{frames: ['frame.jpg'], sceneId: 'scene-1', timeRange: [0, 1]}])

    expect(scenes).to.deep.equal([
      {
        actions: [],
        characters: [],
        description: 'scene scene-1',
        emotions: [],
        evidence: ['frame.jpg'],
        plotClues: [],
        relationships: [],
        sceneId: 'scene-1',
      },
    ])
  })

  it('rejects zero-length VLM input ranges before running the command', async () => {
    const provider = new CommandVLMProvider({
      command: jsonCommand('[{"actions":[],"characters":[],"sceneId":"scene-1","description":"scene scene-1","emotions":[],"evidence":["frame.jpg"],"plotClues":[],"relationships":[]}]'),
    })
    let error: unknown

    try {
      await provider.analyzeScenes([{frames: ['frame.jpg'], sceneId: 'scene-1', timeRange: [1, 1]}])
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('Scene frame batch timeRange end must be greater than start')
  })

  it('runs a TTS command provider over JSON stdin/stdout', async () => {
    const provider = new CommandTTSProvider({
      command: jsonCommand('[{"duration":2,"narrationId":"narration-1","path":"tts/narration-1.wav"}]'),
    })

    const segments = await provider.synthesize([{duration: 2, id: 'narration-1', text: 'hello'}])

    expect(segments).to.deep.equal([
      {
        duration: 2,
        narrationId: 'narration-1',
        path: 'tts/narration-1.wav',
      },
    ])
  })

  it('returns structured validation errors for invalid provider output', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand('{"text":"bad","segments":[{"start":2,"end":1,"text":"bad"}]}'),
    })
    let error: unknown

    try {
      await provider.transcribe({path: '/tmp/audio.wav'})
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(ProviderResponseValidationError)
    expect((error as ProviderResponseValidationError).role).to.equal('asr')
    expect((error as ProviderResponseValidationError).issues.map((issue) => issue.path.join('.'))).to.include('segments.0.end')
    expect((error as Error).message).to.include('segments.0.end')
  })

  it('returns structured validation errors for zero-length ASR segments', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand('{"text":"bad","segments":[{"start":1,"end":1,"text":"bad"}],"timestampConfidence":"exact"}'),
    })
    let error: unknown

    try {
      await provider.transcribe({path: '/tmp/audio.wav'})
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(ProviderResponseValidationError)
    expect((error as ProviderResponseValidationError).role).to.equal('asr')
    expect((error as ProviderResponseValidationError).issues.map((issue) => issue.path.join('.'))).to.include('segments.0.end')
  })

  it('returns structured validation errors when VLM output does not match requested frame batches', async () => {
    const provider = new CommandVLMProvider({
      command: jsonCommand('[{"actions":[],"characters":[],"sceneId":"scene-other","description":"wrong scene","emotions":[],"evidence":["other.jpg"],"plotClues":[],"relationships":[]}]'),
    })
    let error: unknown

    try {
      await provider.analyzeScenes([{frames: ['frame.jpg'], sceneId: 'scene-1', timeRange: [0, 1]}])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(ProviderResponseValidationError)
    expect((error as ProviderResponseValidationError).role).to.equal('vlm')
    expect((error as ProviderResponseValidationError).issues.map((issue) => issue.code)).to.include.members([
      'vlm_scene_id_mismatch',
      'vlm_evidence_frame_mismatch',
    ])
  })

  it('returns structured validation errors for non-positive TTS duration', async () => {
    const provider = new CommandTTSProvider({
      command: jsonCommand('[{"duration":0,"narrationId":"narration-1","path":"tts/narration-1.wav"}]'),
    })
    let error: unknown

    try {
      await provider.synthesize([{duration: 2, id: 'narration-1', text: 'hello'}])
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(ProviderResponseValidationError)
    expect((error as ProviderResponseValidationError).role).to.equal('tts')
    expect((error as ProviderResponseValidationError).issues.map((issue) => issue.path.join('.'))).to.include('0.duration')
  })

  it('returns structured execution errors for failed commands', async () => {
    const provider = new CommandASRProvider({
      command: ['sh', '-c', 'cat >/dev/null; printf "%s" "temporary failure" >&2; exit 124'],
    })
    let error: unknown

    try {
      await provider.transcribe({path: '/tmp/audio.wav'})
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(ProviderExecutionError)
    expect(error).to.deep.include({
      code: 'command_exit',
      retryable: true,
      role: 'asr',
    })
    expect((error as ProviderExecutionError).details).to.deep.include({
      exitCode: 124,
      stderr: 'temporary failure',
    })
  })

  it('returns structured execution errors for invalid command JSON', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand('not json'),
    })
    let error: unknown

    try {
      await provider.transcribe({path: '/tmp/audio.wav'})
    } catch (error_) {
      error = error_
    }

    expect(error).to.be.instanceOf(ProviderExecutionError)
    expect(error).to.deep.include({
      code: 'command_invalid_json',
      retryable: false,
      role: 'asr',
    })
    expect((error as ProviderExecutionError).details).to.deep.include({
      stdout: 'not json\n',
    })
  })

  it('fails fast when command provider env is missing', () => {
    expect(() => createAsrProvider('command', {env: {}})).to.throw('VIDEO_AGENT_ASR_COMMAND')
  })

  it('runs the documented command adapter recipe', async () => {
    const command = ['bun', 'examples/provider-adapters/mock-json-provider.ts']
    const asr = new CommandASRProvider({command})
    const vlm = new CommandVLMProvider({command})
    const tts = new CommandTTSProvider({command})

    const transcript = await asr.transcribe({path: '/tmp/audio.wav'})
    const scenes = await vlm.analyzeScenes([{frames: ['frame.jpg'], sceneId: 'scene-1', timeRange: [0, 1]}])
    const segments = await tts.synthesize([{duration: 2, id: 'narration-1', text: 'hello'}])

    expect(transcript.text).to.equal('Example transcript for /tmp/audio.wav')
    expect(readProviderMetadata(transcript)?.model).to.equal('example-command-provider')
    expect(scenes[0]).to.deep.equal({
      actions: [],
      characters: [],
      description: 'Example visual analysis for scene-1',
      emotions: [],
      evidence: ['frame.jpg'],
      plotClues: [],
      relationships: [],
      sceneId: 'scene-1',
    })
    expect(segments[0]).to.deep.equal({
      duration: 2,
      narrationId: 'narration-1',
      path: 'tts/narration-1.wav',
    })
  })
})

function jsonCommand(json: string): string[] {
  return ['sh', '-c', String.raw`cat >/dev/null; printf "%s\n" "$1"`, 'provider-json', json]
}

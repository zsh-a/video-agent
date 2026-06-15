import {expect} from '#test/expect'

import {CommandASRProvider, CommandTTSProvider, CommandVLMProvider, createAsrProvider, ProviderResponseValidationError, readProviderMetadata} from '../../../packages/providers/src/index.js'

describe('command providers', () => {
  it('runs an ASR command provider over JSON stdin/stdout', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand('{"text":"command transcript","segments":[{"start":0,"end":1,"text":"command transcript"}]}'),
    })

    const transcript = await provider.transcribe({path: '/tmp/audio.wav'})

    expect(transcript.text).to.equal('command transcript')
    expect(transcript.segments[0].start).to.equal(0)
  })

  it('preserves provider response metadata from command envelopes', async () => {
    const provider = new CommandASRProvider({
      command: jsonCommand(
        '{"data":{"text":"command transcript","segments":[{"start":0,"end":1,"text":"command transcript"}]},"metadata":{"cost":{"amount":0.01,"currency":"USD","estimated":true},"model":"asr-test","requestId":"req-1","usage":{"audioSeconds":1,"outputCharacters":18}}}',
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

  it('runs a VLM command provider over JSON stdin/stdout', async () => {
    const provider = new CommandVLMProvider({
      command: jsonCommand('[{"sceneId":"scene-1","description":"scene scene-1","evidence":["frame.jpg"]}]'),
    })

    const scenes = await provider.analyzeScenes([{frames: ['frame.jpg'], sceneId: 'scene-1', timeRange: [0, 1]}])

    expect(scenes).to.deep.equal([
      {
        description: 'scene scene-1',
        evidence: ['frame.jpg'],
        sceneId: 'scene-1',
      },
    ])
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
      description: 'Example visual analysis for scene-1',
      evidence: ['frame.jpg'],
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

import {expect} from '#test/expect'

import type {ASRResult, FilmScenes, LongVideoAnalysisFrames, SilencePeriods, SourceManifest, VLMAnalysis} from '../../../packages/ir/src/index.js'
import type {ProviderSet, SceneFrameBatch, Transcript} from '../../../packages/providers/src/index.js'

import {createFilmAsrResultFromTranscript, createFilmFrameManifest, createFilmScenesFromEvidence, createFilmSilencePeriods, createFilmVlmAnalysis, createTimelineFusion} from '../../../packages/pipeline-film/src/understanding/evidence.js'

const sourceManifest: SourceManifest = {
  audioTracks: 1,
  duration: 10,
  orientation: 'landscape',
  sourceHash: 'source-hash',
  sourcePath: '/tmp/source.mp4',
  version: 1,
}

function asrResult(overrides: Partial<ASRResult> = {}): ASRResult {
  return {
    language: 'en-US',
    segments: [
      {
        end: 2,
        id: 'asr-0001',
        start: 0,
        text: 'A timed transcript segment.',
        timestampConfidence: 'exact',
      },
    ],
    text: 'A timed transcript segment.',
    timestampConfidence: 'exact',
    version: 1,
    ...overrides,
  }
}

function silencePeriods(): SilencePeriods {
  return {
    periods: [],
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function filmScenes(): FilmScenes {
  return {
    scenes: [
      {id: 'scene-001', sourceRange: [0, 1]},
    ],
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function emptyFilmScenes(): FilmScenes {
  return {
    scenes: [],
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function analysisFrames(): LongVideoAnalysisFrames {
  return {
    frameCount: 1,
    framePattern: '/tmp/frames/film-scene-%03d.jpg',
    frames: [
      {
        path: '/tmp/frames/film-scene-001.jpg',
        timestamp: 0.5,
      },
    ],
    sampleFps: 1,
    source: sourceManifest.sourcePath,
    version: 1,
  }
}

function vlmProvider(scene: {
  actions?: string[]
  characters?: string[]
  description?: string
  emotions?: string[]
  plotClues?: string[]
  relationships?: string[]
}): ProviderSet {
  return {
    vlm: {
      async analyzeScenes(_batches: SceneFrameBatch[]) {
        return [{
          actions: scene.actions ?? ['visible action'],
          characters: scene.characters ?? ['Lead'],
          description: scene.description ?? 'A clean visual scene summary.',
          emotions: scene.emotions ?? ['focused'],
          evidence: ['/tmp/frames/film-scene-001.jpg'],
          plotClues: scene.plotClues ?? ['certification evidence'],
          relationships: scene.relationships ?? ['operator to system'],
          sceneId: 'scene-001',
        }]
      },
    },
  } as ProviderSet
}

describe('film understanding evidence', () => {
  it('requires provider-authored ASR timestamp confidence instead of inferring it from segment ranges', () => {
    const transcript: Transcript = {
      language: 'en-US',
      segments: [
        {
          end: 2,
          start: 0,
          text: 'A timed transcript segment.',
        },
      ],
      text: 'A timed transcript segment.',
    }

    expect(() => createFilmAsrResultFromTranscript(transcript, sourceManifest)).to.throw('explicit timestampConfidence')
  })

  it('copies exact provider ASR timestamp confidence to every segment', () => {
    const result = createFilmAsrResultFromTranscript({
      language: 'en-US',
      segments: [
        {
          end: 2,
          start: 0,
          text: 'A timed transcript segment.',
        },
      ],
      text: 'A timed transcript segment.',
      timestampConfidence: 'exact',
    }, sourceManifest)

    expect(result.timestampConfidence).to.equal('exact')
    expect(result.segments[0]).to.deep.include({
      end: 2,
      id: 'asr-0001',
      start: 0,
      text: 'A timed transcript segment.',
      timestampConfidence: 'exact',
    })
  })

  it('rejects ASR timestamps outside the source duration instead of clipping them', () => {
    expect(() => createFilmAsrResultFromTranscript({
      language: 'en-US',
      segments: [
        {
          end: 12,
          start: 9,
          text: 'This provider segment exceeds the video duration.',
        },
      ],
      text: 'This provider segment exceeds the video duration.',
      timestampConfidence: 'exact',
    }, sourceManifest)).to.throw('no timestamp clipping is allowed')

    expect(() => createFilmAsrResultFromTranscript({
      language: 'en-US',
      segments: [
        {
          end: 2,
          start: 1,
          text: '   ',
        },
      ],
      text: '',
      timestampConfidence: 'exact',
    }, sourceManifest)).to.throw('no silent ASR segment filtering is allowed')
  })

  it('rejects ASR transcript text trim instead of rewriting provider evidence', () => {
    expect(() => createFilmAsrResultFromTranscript({
      language: 'en-US',
      segments: [
        {
          end: 2,
          start: 0,
          text: 'A timed transcript segment.',
        },
      ],
      text: ' A timed transcript segment.',
      timestampConfidence: 'exact',
    }, sourceManifest)).to.throw('no runtime transcript text trim is allowed')
  })

  it('rejects ASR segment text trim instead of rewriting timed evidence', () => {
    expect(() => createFilmAsrResultFromTranscript({
      language: 'en-US',
      segments: [
        {
          end: 2,
          start: 0,
          text: 'A timed transcript segment. ',
        },
      ],
      text: 'A timed transcript segment.',
      timestampConfidence: 'exact',
    }, sourceManifest)).to.throw('no runtime ASR segment text trim is allowed')
  })

  it('rejects VLM scene batches without in-range frames instead of using indexed frame fallback', async () => {
    const scenes = filmScenes()
    const frames = {
      ...analysisFrames(),
      frames: [{path: '/tmp/frames/film-scene-001.jpg', timestamp: 5}],
    }
    let providerCalled = false
    let error: unknown

    try {
      await createFilmVlmAnalysis(sourceManifest, scenes, frames, {
        vlm: {
          async analyzeScenes(_batches: SceneFrameBatch[]) {
            providerCalled = true

            return []
          },
        },
      } as ProviderSet)
    } catch (caught) {
      error = caught
    }

    expect(providerCalled).to.equal(false)
    expect(String(error)).to.include('no indexed frame fallback is allowed')
  })

  it('rejects VLM description trim instead of rewriting provider visual evidence', async () => {
    let error: unknown

    try {
      await createFilmVlmAnalysis(sourceManifest, filmScenes(), analysisFrames(), vlmProvider({
        description: ' A clean visual scene summary.',
      }))
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('no runtime VLM text trim is allowed')
  })

  it('rejects VLM semantic array trim instead of cleaning provider tags', async () => {
    let error: unknown

    try {
      await createFilmVlmAnalysis(sourceManifest, filmScenes(), analysisFrames(), vlmProvider({
        actions: ['visible action', ' visible action'],
      }))
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('VLM provider scene "scene-001" actions item 2')
    expect(String(error)).to.include('no runtime semantic string trim is allowed')
  })

  it('rejects VLM semantic array duplicates instead of deduplicating provider tags', async () => {
    let error: unknown

    try {
      await createFilmVlmAnalysis(sourceManifest, filmScenes(), analysisFrames(), vlmProvider({
        characters: ['Lead', 'Lead'],
      }))
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('VLM provider scene "scene-001" characters item 2')
    expect(String(error)).to.include('no runtime semantic string deduplication is allowed')
  })

  it('rejects VLM fusion summary trim instead of repairing existing visual artifacts', () => {
    const vlmAnalysis: VLMAnalysis = {
      scenes: [{
        actions: [],
        characters: [],
        emotions: [],
        evidence: [{ref: 'vlm-analysis.json#vlm-001', text: ' Visual summary.', type: 'vlm'}],
        id: 'vlm-001',
        plotClues: [],
        relationships: [],
        sceneId: 'scene-001',
        sourceRange: [0, 1],
        summary: ' Visual summary.',
      }],
      source: sourceManifest.sourcePath,
      version: 1,
    }

    expect(() => createTimelineFusion(sourceManifest, filmScenes(), asrResult(), silencePeriods(), vlmAnalysis))
      .to.throw('no runtime VLM summary trim is allowed')
  })

  it('rejects invalid ASR segments during scene planning instead of silently filtering them', () => {
    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult({
      segments: [
        {
          end: 0,
          id: 'asr-0001',
          start: 0,
          text: 'Zero-length segment.',
          timestampConfidence: 'exact',
        },
      ],
    }), silencePeriods(), [], 4)).to.throw('no silent ASR segment filtering is allowed')

    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult({
      segments: [],
    }), silencePeriods(), [], 4)).to.throw('no transcript-wide fallback is allowed')
  })

  it('rejects zero-duration source manifests during scene planning instead of creating synthetic ranges', () => {
    expect(() => createFilmScenesFromEvidence({
      ...sourceManifest,
      duration: 0,
    }, asrResult(), silencePeriods(), [], 4)).to.throw('no zero-duration Film source fallback is allowed')
  })

  it('rejects invalid scene limits instead of defaulting or clamping maxScenes', () => {
    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult(), silencePeriods(), [], Number.NaN))
      .to.throw('no scene-limit default or clamp fallback is allowed')

    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult(), silencePeriods(), [], 0))
      .to.throw('no scene-limit default or clamp fallback is allowed')

    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult(), silencePeriods(), [], 1.5))
      .to.throw('no scene-limit default or clamp fallback is allowed')
  })

  it('rejects out-of-range visual scene boundaries instead of clipping them to source duration', () => {
    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult(), silencePeriods(), [12], 4))
      .to.throw('no scene-boundary clipping fallback is allowed')

    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult(), silencePeriods(), [-0.1], 4))
      .to.throw('no scene-boundary clipping fallback is allowed')
  })

  it('rejects out-of-range silence boundaries instead of clipping them to source duration', () => {
    expect(() => createFilmScenesFromEvidence(sourceManifest, asrResult(), {
      periods: [{
        end: 11,
        id: 'silence-001',
        reason: 'detected',
        start: 9,
      }],
      source: sourceManifest.sourcePath,
      version: 1,
    }, [], 4)).to.throw('no scene-boundary clipping fallback is allowed')
  })

  it('rejects empty scene artifacts before writing a frame manifest instead of using sampleFps fallback', async () => {
    let error: unknown

    try {
      await createFilmFrameManifest('/tmp/video-agent-empty-film-frames', sourceManifest, emptyFilmScenes())
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('no empty frame manifest or sampleFps fallback is allowed')
  })

  it('rejects empty scene artifacts before VLM analysis instead of returning an empty analysis', async () => {
    let error: unknown

    try {
      await createFilmVlmAnalysis(sourceManifest, emptyFilmScenes(), analysisFrames(), vlmProvider({}))
    } catch (caught) {
      error = caught
    }

    expect(String(error)).to.include('no empty VLM analysis fallback is allowed')
  })

  it('rejects invalid ASR segments during silence detection instead of silently filtering them', () => {
    expect(() => createFilmSilencePeriods(sourceManifest, asrResult({
      segments: [
        {
          end: 1,
          id: 'asr-0001',
          start: 1,
          text: 'Zero-length segment.',
          timestampConfidence: 'exact',
        },
      ],
    }))).to.throw('no silent ASR segment filtering is allowed')

    const periods = createFilmSilencePeriods(sourceManifest, asrResult({
      segments: [],
    }))

    expect(periods.periods).to.deep.equal([{
      end: sourceManifest.duration,
      id: 'silence-001',
      reason: 'detected',
      start: 0,
    }])
  })

  it('rejects zero-duration source manifests during silence detection instead of returning synthetic silence', () => {
    expect(() => createFilmSilencePeriods({
      ...sourceManifest,
      duration: 0,
    }, asrResult())).to.throw('no zero-duration Film source fallback is allowed')
  })
})

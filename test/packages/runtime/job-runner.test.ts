import type {LanguageModel} from 'ai'

import {expect} from '#test/expect'
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AISDKLLMClient} from '../../../packages/llm/src/index.js'
import {runProcess} from '../../../packages/media/src/process.js'
import {analyzeSceneBatches, createChunkTranscript, createChunkVlmScenes, createSceneFrameBatchesFromTranscript, createSilenceRanges, mergeChunkTranscripts, offsetChunkTranscript, runInitialPipeline, transcribeSourceAudio, validateVlmSceneAnalysis} from '../../../packages/runtime/src/job-runner.js'
import {createProjectWorkspace} from '../../../packages/runtime/src/workspace.js'

describe('job runner', () => {
  it('creates VLM scene batches from transcript segment timing', () => {
    const batches = createSceneFrameBatchesFromTranscript({
      segments: [
        {
          end: 2,
          start: 0,
          text: 'Opening.',
        },
        {
          end: 8,
          start: 2,
          text: 'Ending.',
        },
      ],
      text: 'Opening. Ending.',
    }, {
      duration: 5,
      inputPath: '/tmp/input.mp4',
      probedAt: '2026-06-15T00:00:00.000Z',
      streams: [],
      version: 1,
    }, 'frames/frame_%05d.jpg')

    expect(batches).to.deep.equal([
      {
        frames: ['frames/frame_%05d.jpg'],
        sceneId: 'scene-1',
        timeRange: [0, 2],
      },
      {
        frames: ['frames/frame_%05d.jpg'],
        sceneId: 'scene-2',
        timeRange: [2, 5],
      },
    ])
  })

  it('assigns extracted VLM frames to scene timing windows', () => {
    const batches = createSceneFrameBatchesFromTranscript({
      segments: [
        {
          end: 2,
          start: 0,
          text: 'Opening.',
        },
        {
          end: 4,
          start: 2,
          text: 'Ending.',
        },
      ],
      text: 'Opening. Ending.',
    }, {
      duration: 4,
      inputPath: '/tmp/input.mp4',
      probedAt: '2026-06-15T00:00:00.000Z',
      streams: [],
      version: 1,
    }, [
      {path: 'frames/frame_00001.jpg', timestamp: 0},
      {path: 'frames/frame_00002.jpg', timestamp: 1},
      {path: 'frames/frame_00003.jpg', timestamp: 2},
      {path: 'frames/frame_00004.jpg', timestamp: 3},
    ])

    expect(batches).to.deep.equal([
      {
        frames: ['frames/frame_00001.jpg', 'frames/frame_00002.jpg'],
        sceneId: 'scene-1',
        timeRange: [0, 2],
      },
      {
        frames: ['frames/frame_00003.jpg', 'frames/frame_00004.jpg'],
        sceneId: 'scene-2',
        timeRange: [2, 4],
      },
    ])
  })

  it('samples VLM scene frames with chunk-plan frame defaults', () => {
    const batches = createSceneFrameBatchesFromTranscript({
      segments: [
        {
          end: 10,
          start: 0,
          text: 'Long scene.',
        },
      ],
      text: 'Long scene.',
    }, {
      duration: 10,
      inputPath: '/tmp/input.mp4',
      probedAt: '2026-06-15T00:00:00.000Z',
      streams: [],
      version: 1,
    }, Array.from({length: 10}, (_, index) => ({
      path: `frames/frame_${String(index + 1).padStart(5, '0')}.jpg`,
      timestamp: index,
    })), {
      maxFramesPerBatch: 2,
      sampleFps: 0.5,
    })

    expect(batches).to.deep.equal([
      {
        frames: ['frames/frame_00001.jpg', 'frames/frame_00009.jpg'],
        sceneId: 'scene-1',
        timeRange: [0, 10],
      },
    ])
  })

  it('uses explicit chunk-plan duration for VLM scene boundaries', () => {
    const batches = createSceneFrameBatchesFromTranscript({
      segments: [
        {
          end: 20,
          start: 0,
          text: 'Scene with stream duration.',
        },
      ],
      text: 'Scene with stream duration.',
    }, {
      inputPath: '/tmp/input.mp4',
      probedAt: '2026-06-15T00:00:00.000Z',
      streams: [],
      version: 1,
    }, undefined, {
      mediaDuration: 12,
    })

    expect(batches).to.deep.equal([
      {
        frames: [],
        sceneId: 'scene-1',
        timeRange: [0, 12],
      },
    ])
  })

  it('offsets and merges chunk ASR transcripts onto the source timeline', () => {
    const first = offsetChunkTranscript({
      language: 'zh-CN',
      segments: [
        {
          end: 2,
          start: 0.5,
          text: 'First chunk.',
        },
      ],
      text: 'First chunk.',
    }, [10, 20])
    const second = offsetChunkTranscript({
      segments: [
        {
          end: 0,
          start: 0,
          text: 'Untimed chunk.',
        },
      ],
      text: 'Untimed chunk.',
    }, [20, 30])

    expect(first.segments).to.deep.equal([
      {
        end: 12,
        start: 10.5,
        text: 'First chunk.',
      },
    ])
    expect(second.segments).to.deep.equal([
      {
        end: 30,
        start: 20,
        text: 'Untimed chunk.',
      },
    ])
    expect(mergeChunkTranscripts([second, first])).to.deep.equal({
      language: 'zh-CN',
      segments: [
        {
          end: 12,
          start: 10.5,
          text: 'First chunk.',
        },
        {
          end: 30,
          start: 20,
          text: 'Untimed chunk.',
        },
      ],
      text: 'First chunk.\nUntimed chunk.',
      timestampConfidence: 'chunked',
    })
  })

  it('uses overlapped analysis ASR ranges without overlapping chunk transcript timings', () => {
    const firstAnalysis = createChunkTranscript(offsetChunkTranscript({
      language: 'zh-CN',
      segments: [
        {
          end: 2,
          start: 0,
          text: 'First content.',
        },
        {
          end: 5.5,
          start: 4,
          text: 'Overlap context.',
        },
      ],
      text: 'First content. Overlap context.',
    }, [0, 6]), [0, 5])
    const secondAnalysis = createChunkTranscript(offsetChunkTranscript({
      language: 'zh-CN',
      segments: [
        {
          end: 1.5,
          start: 0,
          text: 'Overlap context.',
        },
        {
          end: 5,
          start: 2,
          text: 'Second content.',
        },
      ],
      text: 'Overlap context. Second content.',
    }, [4, 10]), [5, 10])

    expect(firstAnalysis.segments).to.deep.equal([
      {
        end: 2,
        start: 0,
        text: 'First content.',
      },
      {
        end: 5,
        start: 4,
        text: 'Overlap context.',
      },
    ])
    expect(secondAnalysis.segments).to.deep.equal([
      {
        end: 5.5,
        start: 5,
        text: 'Overlap context.',
      },
      {
        end: 9,
        start: 6,
        text: 'Second content.',
      },
    ])
    expect(mergeChunkTranscripts([firstAnalysis, secondAnalysis]).segments).to.deep.equal([
      {
        end: 2,
        start: 0,
        text: 'First content.',
      },
      {
        end: 5,
        start: 4,
        text: 'Overlap context.',
      },
      {
        end: 5.5,
        start: 5,
        text: 'Overlap context.',
      },
      {
        end: 9,
        start: 6,
        text: 'Second content.',
      },
    ])
  })

  it('reuses valid per-chunk transcript artifacts during chunked ASR reruns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-asr-cache-'))
    const workspace = await createProjectWorkspace({
      projectId: 'demo',
      workspaceDir: root,
    })
    let asrCalls = 0

    try {
      await workspace.store.writeJson('chunks/000/transcript.json', {
        language: 'zh-CN',
        segments: [
          {
            end: 2,
            start: 0,
            text: 'Cached first chunk.',
          },
        ],
        text: 'Cached first chunk.',
        timestampConfidence: 'chunked',
      })
      await workspace.store.writeJson('chunks/001/transcript.json', {
        language: 'zh-CN',
        segments: [
          {
            end: 7,
            start: 5,
            text: 'Cached second chunk.',
          },
        ],
        text: 'Cached second chunk.',
        timestampConfidence: 'chunked',
      })

      const transcript = await transcribeSourceAudio({
        artifacts: {
          chapters: workspace.store.resolve('chapters.json'),
          chunkPlan: workspace.store.resolve('chunk-plan.json'),
          chunkSummaries: workspace.store.resolve('chunk-summaries.json'),
          clipPlan: workspace.store.resolve('clip-plan.json'),
          globalOutline: workspace.store.resolve('global-outline.json'),
          ingestReport: workspace.store.resolve('ingest-report.json'),
          mediaInfo: workspace.store.resolve('media-info.json'),
          narration: workspace.store.resolve('narration.json'),
          pipelineEvents: workspace.store.resolve('pipeline-events.jsonl'),
          preview: join(workspace.rendersDir, 'preview.mp4'),
          providerCalls: workspace.store.resolve('provider-calls.jsonl'),
          qualityReport: workspace.store.resolve('quality-report.json'),
          sceneAnalysis: workspace.store.resolve('scene-analysis.json'),
          sceneBatches: workspace.store.resolve('scene-batches.json'),
          selectedMoments: workspace.store.resolve('selected-moments.json'),
          sourceAudio: join(workspace.audioDir, 'missing-source.wav'),
          storyboard: workspace.store.resolve('storyboard.json'),
          timeline: workspace.store.resolve('timeline.json'),
          transcript: workspace.store.resolve('transcript.json'),
          ttsSegments: workspace.store.resolve('tts-segments.json'),
        },
        chunkPlan: {
          chunks: [
            {
              analysisRange: [0, 6],
              artifactPrefix: 'chunks/000',
              contentRange: [0, 5],
              duration: 5,
              id: 'chunk-000',
              index: 0,
            },
            {
              analysisRange: [4, 10],
              artifactPrefix: 'chunks/001',
              contentRange: [5, 10],
              duration: 5,
              id: 'chunk-001',
              index: 1,
            },
          ],
          defaults: {
            asrChunking: true,
            chunkDuration: 5,
            chunkOverlap: 1,
            frameSampleFps: 1,
            sceneDetection: true,
            vlmBatchSize: 16,
            vlmFrameSampleFps: 0.2,
          },
          source: '/tmp/input.mp4',
          sourceDuration: 10,
          version: 1,
        },
        inputPath: '/tmp/input.mp4',
        mediaInfo: {
          duration: 10,
          inputPath: '/tmp/input.mp4',
          probedAt: '2026-06-16T00:00:00.000Z',
          streams: [
            {
              index: 0,
              type: 'audio',
            },
          ],
          version: 1,
        },
        providers: {
          asr: {
            async transcribe() {
              asrCalls += 1
              throw new Error('ASR should not run for cached chunks.')
            },
          },
          script: {
            async createNarration() {
              throw new Error('Not used by this test.')
            },
          },
          storyboard: {
            async createStoryboard() {
              throw new Error('Not used by this test.')
            },
          },
          tts: {
            async synthesize() {
              throw new Error('Not used by this test.')
            },
          },
          vlm: {
            async analyzeScenes() {
              throw new Error('Not used by this test.')
            },
          },
        },
        workspace,
      }, {
        artifactsDir: workspace.artifactsDir,
        async emit() {},
        projectId: workspace.projectId,
        workspaceDir: workspace.workspaceDir,
      })

      expect(asrCalls).to.equal(0)
      expect(transcript).to.deep.equal({
        language: 'zh-CN',
        segments: [
          {
            end: 2,
            start: 0,
            text: 'Cached first chunk.',
          },
          {
            end: 7,
            start: 5,
            text: 'Cached second chunk.',
          },
        ],
        text: 'Cached first chunk.\nCached second chunk.',
        timestampConfidence: 'chunked',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reuses valid scene analysis artifacts during VLM reruns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-cache-'))
    const workspace = await createProjectWorkspace({
      projectId: 'demo',
      workspaceDir: root,
    })
    const sceneBatches = [
      {
        frames: ['frames/frame_00001.jpg'],
        sceneId: 'scene-1',
        timeRange: [0, 2] as [number, number],
      },
      {
        frames: ['frames/frame_00002.jpg'],
        sceneId: 'scene-2',
        timeRange: [2, 4] as [number, number],
      },
    ]
    const cachedSceneAnalysis = [
      {
        description: 'Cached first visual scene.',
        evidence: ['frames/frame_00001.jpg'],
        sceneId: 'scene-1',
      },
      {
        description: 'Cached second visual scene.',
        evidence: ['frames/frame_00002.jpg'],
        sceneId: 'scene-2',
      },
    ]
    let vlmCalls = 0

    try {
      await workspace.store.writeJson('scene-analysis.json', cachedSceneAnalysis)
      await workspace.store.writeJson('scene-batches.json', sceneBatches)

      const sceneAnalysis = await analyzeSceneBatches({
        artifacts: {
          chapters: workspace.store.resolve('chapters.json'),
          chunkPlan: workspace.store.resolve('chunk-plan.json'),
          chunkSummaries: workspace.store.resolve('chunk-summaries.json'),
          clipPlan: workspace.store.resolve('clip-plan.json'),
          globalOutline: workspace.store.resolve('global-outline.json'),
          ingestReport: workspace.store.resolve('ingest-report.json'),
          mediaInfo: workspace.store.resolve('media-info.json'),
          narration: workspace.store.resolve('narration.json'),
          pipelineEvents: workspace.store.resolve('pipeline-events.jsonl'),
          preview: join(workspace.rendersDir, 'preview.mp4'),
          providerCalls: workspace.store.resolve('provider-calls.jsonl'),
          qualityReport: workspace.store.resolve('quality-report.json'),
          sceneAnalysis: workspace.store.resolve('scene-analysis.json'),
          sceneBatches: workspace.store.resolve('scene-batches.json'),
          selectedMoments: workspace.store.resolve('selected-moments.json'),
          storyboard: workspace.store.resolve('storyboard.json'),
          timeline: workspace.store.resolve('timeline.json'),
          transcript: workspace.store.resolve('transcript.json'),
          ttsSegments: workspace.store.resolve('tts-segments.json'),
        },
        chunkPlan: {
          chunks: [],
          defaults: {
            asrChunking: true,
            chunkDuration: 300,
            chunkOverlap: 10,
            frameSampleFps: 1,
            sceneDetection: true,
            vlmBatchSize: 16,
            vlmFrameSampleFps: 0.2,
          },
          source: '/tmp/input.mp4',
          sourceDuration: 4,
          version: 1,
        },
        inputPath: '/tmp/input.mp4',
        mediaInfo: {
          duration: 4,
          inputPath: '/tmp/input.mp4',
          probedAt: '2026-06-16T00:00:00.000Z',
          streams: [],
          version: 1,
        },
        providers: {
          asr: {
            async transcribe() {
              throw new Error('Not used by this test.')
            },
          },
          script: {
            async createNarration() {
              throw new Error('Not used by this test.')
            },
          },
          storyboard: {
            async createStoryboard() {
              throw new Error('Not used by this test.')
            },
          },
          tts: {
            async synthesize() {
              throw new Error('Not used by this test.')
            },
          },
          vlm: {
            async analyzeScenes() {
              vlmCalls += 1
              throw new Error('VLM should not run for cached scene analysis.')
            },
          },
        },
        workspace,
      }, sceneBatches, {
        artifactsDir: workspace.artifactsDir,
        async emit() {},
        projectId: workspace.projectId,
        workspaceDir: workspace.workspaceDir,
      })

      expect(vlmCalls).to.equal(0)
      expect(sceneAnalysis).to.deep.equal(cachedSceneAnalysis)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reruns VLM when cached scene batch metadata is stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-vlm-stale-cache-'))
    const workspace = await createProjectWorkspace({
      projectId: 'demo',
      workspaceDir: root,
    })
    const sceneBatches = [
      {
        frames: ['frames/frame_00002.jpg'],
        sceneId: 'scene-1',
        timeRange: [0, 2] as [number, number],
      },
    ]
    const freshSceneAnalysis = [
      {
        description: 'Fresh visual scene.',
        evidence: ['frames/frame_00002.jpg'],
        sceneId: 'scene-1',
      },
    ]
    let vlmCalls = 0

    try {
      await workspace.store.writeJson('scene-analysis.json', [
        {
          description: 'Stale visual scene.',
          evidence: ['frames/frame_00001.jpg'],
          sceneId: 'scene-1',
        },
      ])
      await workspace.store.writeJson('scene-batches.json', [
        {
          frames: ['frames/frame_00001.jpg'],
          sceneId: 'scene-1',
          timeRange: [0, 2],
        },
      ])

      const sceneAnalysis = await analyzeSceneBatches({
        artifacts: {
          chapters: workspace.store.resolve('chapters.json'),
          chunkPlan: workspace.store.resolve('chunk-plan.json'),
          chunkSummaries: workspace.store.resolve('chunk-summaries.json'),
          clipPlan: workspace.store.resolve('clip-plan.json'),
          globalOutline: workspace.store.resolve('global-outline.json'),
          ingestReport: workspace.store.resolve('ingest-report.json'),
          mediaInfo: workspace.store.resolve('media-info.json'),
          narration: workspace.store.resolve('narration.json'),
          pipelineEvents: workspace.store.resolve('pipeline-events.jsonl'),
          preview: join(workspace.rendersDir, 'preview.mp4'),
          providerCalls: workspace.store.resolve('provider-calls.jsonl'),
          qualityReport: workspace.store.resolve('quality-report.json'),
          sceneAnalysis: workspace.store.resolve('scene-analysis.json'),
          sceneBatches: workspace.store.resolve('scene-batches.json'),
          selectedMoments: workspace.store.resolve('selected-moments.json'),
          storyboard: workspace.store.resolve('storyboard.json'),
          timeline: workspace.store.resolve('timeline.json'),
          transcript: workspace.store.resolve('transcript.json'),
          ttsSegments: workspace.store.resolve('tts-segments.json'),
        },
        chunkPlan: {
          chunks: [],
          defaults: {
            asrChunking: true,
            chunkDuration: 300,
            chunkOverlap: 10,
            frameSampleFps: 1,
            sceneDetection: true,
            vlmBatchSize: 16,
            vlmFrameSampleFps: 0.2,
          },
          source: '/tmp/input.mp4',
          sourceDuration: 2,
          version: 1,
        },
        inputPath: '/tmp/input.mp4',
        mediaInfo: {
          duration: 2,
          inputPath: '/tmp/input.mp4',
          probedAt: '2026-06-16T00:00:00.000Z',
          streams: [],
          version: 1,
        },
        providers: {
          asr: {
            async transcribe() {
              throw new Error('Not used by this test.')
            },
          },
          script: {
            async createNarration() {
              throw new Error('Not used by this test.')
            },
          },
          storyboard: {
            async createStoryboard() {
              throw new Error('Not used by this test.')
            },
          },
          tts: {
            async synthesize() {
              throw new Error('Not used by this test.')
            },
          },
          vlm: {
            async analyzeScenes() {
              vlmCalls += 1
              return freshSceneAnalysis
            },
          },
        },
        workspace,
      }, sceneBatches, {
        artifactsDir: workspace.artifactsDir,
        async emit() {},
        projectId: workspace.projectId,
        workspaceDir: workspace.workspaceDir,
      })

      expect(vlmCalls).to.equal(1)
      expect(sceneAnalysis).to.deep.equal(freshSceneAnalysis)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('derives silence ranges from transcript gaps inside a chunk', () => {
    expect(createSilenceRanges({
      segments: [
        {
          end: 3,
          start: 1,
          text: 'Opening.',
        },
        {
          end: 8,
          start: 5,
          text: 'Ending.',
        },
      ],
      text: 'Opening. Ending.',
    }, [0, 10])).to.deep.equal([
      [0, 1],
      [3, 5],
      [8, 10],
    ])
  })

  it('clamps chunk transcript segments to the chunk content range', () => {
    expect(createChunkTranscript({
      language: 'zh-CN',
      segments: [
        {
          end: 6,
          start: 2,
          text: 'Crosses left boundary.',
        },
        {
          end: 11,
          start: 8,
          text: 'Crosses right boundary.',
        },
        {
          end: 13,
          start: 12,
          text: 'Outside chunk.',
        },
      ],
      text: 'Crosses left boundary. Crosses right boundary. Outside chunk.',
      timestampConfidence: 'exact',
    }, [5, 10])).to.deep.equal({
      language: 'zh-CN',
      segments: [
        {
          end: 6,
          start: 5,
          text: 'Crosses left boundary.',
        },
        {
          end: 10,
          start: 8,
          text: 'Crosses right boundary.',
        },
      ],
      text: 'Crosses left boundary.\nCrosses right boundary.',
      timestampConfidence: 'exact',
    })
  })

  it('uses chunk analysis ranges to include overlapping VLM scene context', () => {
    const sceneAnalysis = [
      {
        description: 'First chunk context.',
        evidence: [],
        sceneId: 'scene-1',
      },
      {
        description: 'Boundary context.',
        evidence: [],
        sceneId: 'scene-2',
      },
      {
        description: 'Outside context.',
        evidence: [],
        sceneId: 'scene-3',
      },
    ]
    const sceneRanges = [
      {
        end: 4,
        start: 0,
      },
      {
        end: 5.5,
        start: 4.5,
      },
      {
        end: 8,
        start: 6,
      },
    ]

    expect(createChunkVlmScenes(sceneAnalysis, sceneRanges, [0, 5])).to.deep.equal([
      sceneAnalysis[0],
      sceneAnalysis[1],
    ])
    expect(createChunkVlmScenes(sceneAnalysis, sceneRanges, [0, 4])).to.deep.equal([
      sceneAnalysis[0],
    ])
  })

  it('rejects VLM scene analysis that does not match input batches', () => {
    const batches = [
      {
        frames: ['frames/frame_00001.jpg'],
        sceneId: 'scene-1',
        timeRange: [0, 1] as [number, number],
      },
      {
        frames: ['frames/frame_00002.jpg'],
        sceneId: 'scene-2',
        timeRange: [1, 2] as [number, number],
      },
    ]

    expect(() => validateVlmSceneAnalysis(batches, [
      {
        description: 'Opening.',
        evidence: [],
        sceneId: 'scene-1',
      },
    ])).to.throw('VLM provider returned 1 scene(s), expected 2.')

    expect(() => validateVlmSceneAnalysis(batches, [
      {
        description: 'Opening.',
        evidence: [],
        sceneId: 'scene-1',
      },
      {
        description: 'Wrong scene.',
        evidence: [],
        sceneId: 'scene-x',
      },
    ])).to.throw('VLM provider returned sceneId "scene-x" at index 1, expected "scene-2".')
  })

  it('runs the initial pipeline when ffmpeg and ffprobe are available', async () => {
    if (!(await hasMediaTools())) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-'))
    const inputPath = join(root, 'input.mp4')

    try {
      await runProcess([
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x90:rate=10',
        '-t',
        '1',
        '-pix_fmt',
        'yuv420p',
        inputPath,
      ])

      const events: string[] = []
      const providerCallSummaries: string[] = []
      const result = await runInitialPipeline({
        inputPath,
        onEvent(event) {
          events.push(`${event.type}:${event.stage ?? ''}`)
        },
        onProviderCall(call) {
          providerCallSummaries.push(`${call.role}:${call.provider}:${call.operation}:${call.status}`)
        },
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(result.status).to.equal('completed')
      expect(await fileSize(result.artifacts.mediaInfo)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.chunkPlan)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.chunkSummaries)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.chapters)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.globalOutline)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.selectedMoments)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.sceneAnalysis)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.sceneBatches)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.storyboard)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.clipPlan)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.timeline)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.narration)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.transcript)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.ttsSegments)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.providerCalls)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.qualityReport)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.pipelineEvents)).to.be.greaterThan(0)
      expect(await fileSize(result.artifacts.preview)).to.be.greaterThan(0)
      expect(await fileSize(join(root, 'projects', 'demo', 'job-state.json'))).to.be.greaterThan(0)

      const qualityReport = JSON.parse(await readFile(result.artifacts.qualityReport, 'utf8')) as {summary: {errors: number; warnings: number}}
      const chunkPlan = JSON.parse(await readFile(result.artifacts.chunkPlan, 'utf8')) as {chunks: Array<{artifactPrefix: string; id: string}>}
      const chunkSummaries = JSON.parse(await readFile(result.artifacts.chunkSummaries, 'utf8')) as {chunks: Array<{chunkId: string; silenceRanges: Array<[number, number]>; summary: string}>}
      const storyboard = JSON.parse(await readFile(result.artifacts.storyboard, 'utf8')) as {scenes: Array<{evidence: Array<{ref: string}>; sourceRange?: [number, number]}>}

      expect(qualityReport.summary).to.deep.equal({errors: 0, warnings: 0})
      expect(chunkPlan.chunks[0]?.artifactPrefix).to.equal('chunks/000')
      expect(chunkSummaries.chunks[0]?.chunkId).to.equal('chunk-000')
      expect(chunkSummaries.chunks[0]?.silenceRanges).to.deep.equal([[0, 1]])
      expect(storyboard.scenes[0]?.evidence.map((item) => item.ref)).to.include('chunks/000/vlm.json')
      expect(storyboard.scenes[0]?.sourceRange).to.deep.equal([0, 1])
      expect(await fileSize(join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'summary.json'))).to.be.greaterThan(0)
      expect(await fileSize(join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'silence.json'))).to.be.greaterThan(0)
      expect(await fileSize(join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'transcript.json'))).to.be.greaterThan(0)
      expect(await fileSize(join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'vlm.json'))).to.be.greaterThan(0)

      const providerCalls = await readJsonLines(result.artifacts.providerCalls)
      const pipelineEvents = await readJsonLines(result.artifacts.pipelineEvents)
      const progressEvents = pipelineEvents.filter((event) => event.type === 'stage:progress')
      const artifactEvents = pipelineEvents.filter((event) => event.type === 'artifact')

      expect(providerCalls.map((call) => call.role)).to.include.members(['asr', 'tts', 'vlm'])
      expect(providerCalls.every((call) => call.provider === 'mock')).to.equal(true)
      expect(providerCalls.every((call) => call.status === 'succeeded')).to.equal(true)
      expect(events).to.include.members(['stage:start:ingest', 'stage:complete:ingest', 'stage:start:understand', 'stage:complete:quality'])
      expect(progressEvents.map((event) => `${event.stage}:${event.step}`)).to.include.members(['understand:asr', 'understand:vlm', 'voiceover:tts', 'quality:checks'])
      expect(artifactEvents.map((event) => event.artifact?.path).filter((path): path is string => typeof path === 'string')).to.include.members([
        join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'summary.json'),
        join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'silence.json'),
        join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'transcript.json'),
        join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'vlm.json'),
      ])
      expect(progressEvents.some((event) => event.unit === 'segments')).to.equal(true)
      expect(progressEvents.every((event) => event.percent === undefined || (typeof event.percent === 'number' && event.percent >= 0 && event.percent <= 100))).to.equal(true)
      expect(providerCallSummaries).to.include.members(['asr:mock:transcribe:succeeded', 'vlm:mock:analyzeScenes:succeeded', 'tts:mock:synthesize:succeeded'])

      const manifest = JSON.parse(await readFile(join(root, 'projects', 'demo', 'artifacts', 'artifact-manifest.json'), 'utf8')) as {artifacts: Array<{name: string; sha256: string}>}

      expect(manifest.artifacts.map((artifact) => artifact.name)).to.include.members(['chunk-plan.json', 'chunk-summaries.json', 'chapters.json', 'global-outline.json', 'selected-moments.json', 'scene-batches.json', 'chunks/000/summary.json', 'chunks/000/silence.json', 'chunks/000/transcript.json', 'chunks/000/vlm.json', 'clip-plan.json', 'pipeline-events.jsonl', 'provider-calls.jsonl', 'quality-report.json'])
      expect(manifest.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256))).to.equal(true)

      const resumed = await runInitialPipeline({
        fromStage: 'plan',
        inputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(resumed.status).to.equal('completed')
      expect(await fileSize(resumed.artifacts.narration)).to.be.greaterThan(0)
      expect(await fileSize(resumed.artifacts.ttsSegments)).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails clearly when source media has no video stream', async () => {
    if (!(await hasMediaTools())) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-audio-only-'))
    const inputPath = join(root, 'input.wav')

    try {
      await runProcess([
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:sample_rate=24000',
        '-t',
        '1',
        inputPath,
      ])

      let error: unknown

      try {
        await runInitialPipeline({
          inputPath,
          projectId: 'audio-only',
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(Error)
      expect(error instanceof Error ? error.message : '').to.equal('Source media must include a video stream for the initial video pipeline.')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('runs plan and script stages through an injected AI SDK LLM client', async () => {
    if (!(await hasMediaTools())) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'video-agent-job-llm-'))
    const inputPath = join(root, 'input.mp4')

    try {
      await runProcess([
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=160x90:rate=10',
        '-t',
        '1',
        '-pix_fmt',
        'yuv420p',
        inputPath,
      ])

      const llmClient = new AISDKLLMClient({
        model: createSequentialObjectModel([
          {
            language: 'zh-CN',
            scenes: [
              {
                duration: 1,
                evidence: [
                  {
                    ref: 'scene-analysis.json',
                    text: 'LLM selected visual evidence.',
                    type: 'vlm',
                  },
                ],
                id: 'scene-1',
                narration: 'LLM storyboard narration.',
                sourceRange: [0, 1],
                start: 0,
                visualStyle: 'documentary',
              },
            ],
            targetPlatform: 'generic',
            version: 1,
          },
          {
            language: 'zh-CN',
            segments: [
              {
                duration: 1,
                id: 'narration-1',
                sceneId: 'scene-1',
                start: 0,
                text: 'LLM final narration.',
              },
            ],
            version: 1,
          },
        ]),
      })

      const result = await runInitialPipeline({
        inputPath,
        llmClient,
        projectId: 'demo',
        workspaceDir: root,
      })
      const storyboard = JSON.parse(await readFile(result.artifacts.storyboard, 'utf8')) as {scenes: Array<{narration?: string}>}
      const narration = JSON.parse(await readFile(result.artifacts.narration, 'utf8')) as {segments: Array<{text: string}>}

      expect(result.status).to.equal('completed')
      expect(storyboard.scenes[0]?.narration).to.equal('LLM storyboard narration.')
      expect(narration.segments[0]?.text).to.equal('LLM final narration.')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

async function readJsonLines(path: string): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function hasMediaTools(): Promise<boolean> {
  const [ffmpeg, ffprobe] = await Promise.all([runProcess(['ffmpeg', '-version']), runProcess(['ffprobe', '-version'])])

  return ffmpeg.code === 0 && ffprobe.code === 0
}

function createSequentialObjectModel(objects: object[]): LanguageModel {
  const queue = [...objects]

  return {
    async doGenerate() {
      const object = queue.shift()

      if (object === undefined) {
        throw new Error('No queued LLM object result.')
      }

      return {
        content: [
          {
            text: JSON.stringify(object),
            type: 'text',
          },
        ],
        finishReason: 'stop',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
        warnings: [],
      }
    },
    async doStream() {
      throw new Error('Streaming is not used by this test.')
    },
    modelId: 'mock-llm',
    provider: 'mock',
    specificationVersion: 'v2',
    supportedUrls: {},
  } as LanguageModel
}

import type {LanguageModel} from 'ai'

import {expect} from '#test/expect'
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {AISDKLLMClient} from '../../../packages/llm/src/index.js'
import {runProcess} from '../../../packages/media/src/process.js'
import {createSceneFrameBatchesFromTranscript, runInitialPipeline} from '../../../packages/runtime/src/job-runner.js'

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
      expect(await fileSize(result.artifacts.sceneAnalysis)).to.be.greaterThan(0)
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

      expect(qualityReport.summary).to.deep.equal({errors: 0, warnings: 0})

      const providerCalls = await readJsonLines(result.artifacts.providerCalls)
      const pipelineEvents = await readJsonLines(result.artifacts.pipelineEvents)
      const progressEvents = pipelineEvents.filter((event) => event.type === 'stage:progress')

      expect(providerCalls.map((call) => call.role)).to.include.members(['asr', 'tts', 'vlm'])
      expect(providerCalls.every((call) => call.provider === 'mock')).to.equal(true)
      expect(providerCalls.every((call) => call.status === 'succeeded')).to.equal(true)
      expect(events).to.include.members(['stage:start:ingest', 'stage:complete:ingest', 'stage:start:understand', 'stage:complete:quality'])
      expect(progressEvents.map((event) => `${event.stage}:${event.step}`)).to.include.members(['understand:asr', 'understand:vlm', 'voiceover:tts', 'quality:checks'])
      expect(progressEvents.some((event) => event.unit === 'segments')).to.equal(true)
      expect(progressEvents.every((event) => event.percent === undefined || (typeof event.percent === 'number' && event.percent >= 0 && event.percent <= 100))).to.equal(true)
      expect(providerCallSummaries).to.include.members(['asr:mock:transcribe:succeeded', 'vlm:mock:analyzeScenes:succeeded', 'tts:mock:synthesize:succeeded'])

      const manifest = JSON.parse(await readFile(join(root, 'projects', 'demo', 'artifacts', 'artifact-manifest.json'), 'utf8')) as {artifacts: Array<{name: string; sha256: string}>}

      expect(manifest.artifacts.map((artifact) => artifact.name)).to.include.members(['clip-plan.json', 'pipeline-events.jsonl', 'provider-calls.jsonl', 'quality-report.json'])
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

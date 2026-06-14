import {expect} from 'chai'
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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

  it('runs the initial pipeline when ffmpeg and ffprobe are available', async function () {
    this.timeout(20_000)

    if (!(await hasMediaTools())) {
      this.skip()
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

      const result = await runInitialPipeline({
        inputPath,
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

      expect(providerCalls.map((call) => call.role)).to.include.members(['asr', 'tts', 'vlm'])
      expect(providerCalls.every((call) => call.provider === 'mock')).to.equal(true)
      expect(providerCalls.every((call) => call.status === 'succeeded')).to.equal(true)

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

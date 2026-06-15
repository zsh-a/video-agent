import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runProcess} from '../../../packages/media/src/process.js'
import {inspectFfmpegAudio, renderProject} from '../../../packages/runtime/src/render-project.js'

describe('render project', () => {
  it('generates a HyperFrames project through the runtime API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-render-project-'))

    try {
      await createRenderableProject(root, 'demo')

      const result = await renderProject('demo', {
        renderer: 'hyperframes',
        workspaceDir: root,
      })

      expect(result.renderer).to.equal('hyperframes')

      if (result.renderer === 'hyperframes') {
        expect(await readFile(result.entryHtml, 'utf8')).to.contain('data-duration="1"')
        expect(result.templateQuality).to.deep.equal({
          errors: 0,
          issues: [],
          ok: true,
          warnings: 0,
        })
      }

      const renderOutput = JSON.parse(await readFile(join(root, 'projects', 'demo', 'artifacts', 'render-output.json'), 'utf8')) as {templateQuality?: unknown}

      expect(renderOutput.templateQuality).to.deep.equal({
        errors: 0,
        issues: [],
        ok: true,
        warnings: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes subtitle quality diagnostics when subtitles are enabled', async function () {
    if (!(await hasFfmpeg())) {
      this.skip()
    }

    if (!(await hasFfmpegSubtitleFilter())) {
      this.skip()
    }

    const root = await mkdtemp(join(tmpdir(), 'video-agent-render-project-'))
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
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:sample_rate=48000',
        '-t',
        '1',
        '-shortest',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        inputPath,
      ])
      await createRenderableProject(root, 'demo')
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'timeline.json'),
        `${JSON.stringify({
          duration: 1,
          fps: 10,
          items: [
            {
              duration: 1,
              id: 'video-1',
              source: inputPath,
              sourceRange: [0, 1],
              start: 0,
              track: 'video',
            },
          ],
          version: 1,
        })}\n`,
      )

      await renderProject('demo', {
        output: join(root, 'final.mp4'),
        workspaceDir: root,
      })

      const renderOutputPath = join(root, 'projects', 'demo', 'artifacts', 'render-output.json')
      const renderOutput = JSON.parse(await readFile(renderOutputPath, 'utf8')) as {
        audioQuality?: {errors: number; maxVolumeDb?: number; meanVolumeDb?: number; probed: boolean; warnings: number}
        outputQuality?: {errors: number; probed: boolean; videoStreams: number; warnings: number}
        subtitleQuality?: {cues: number; errors: number; warnings: number}
        visualQuality?: {
          blackDuration: number
          blackRatio?: number
          errors: number
          frameSample?: {ok: boolean; path?: string; sha256?: string; size?: number; timestamp: number}
          frameSamples?: Array<{ok: boolean; path?: string; sha256?: string; size?: number; timestamp: number}>
          probed: boolean
          warnings: number
        }
      }

      expect(renderOutput.outputQuality).to.include({
        errors: 0,
        probed: true,
        videoStreams: 1,
        warnings: 0,
      })
      expect(renderOutput.audioQuality).to.include({
        errors: 0,
        probed: true,
      })
      expect(renderOutput.audioQuality?.meanVolumeDb).to.be.a('number')
      expect(renderOutput.audioQuality?.maxVolumeDb).to.be.a('number')
      expect(renderOutput.visualQuality).to.include({
        errors: 0,
        probed: true,
        warnings: 0,
      })
      expect(renderOutput.visualQuality?.blackDuration).to.be.a('number')
      expect(renderOutput.visualQuality?.frameSample).to.include({
        ok: true,
        timestamp: 0,
      })
      expect(renderOutput.visualQuality?.frameSample?.path).to.be.a('string')
      expect(renderOutput.visualQuality?.frameSample?.sha256).to.match(/^[a-f0-9]{64}$/)
      expect(renderOutput.visualQuality?.frameSample?.size).to.be.greaterThan(0)
      expect((await stat(renderOutput.visualQuality?.frameSample?.path ?? '')).size).to.equal(renderOutput.visualQuality?.frameSample?.size)
      await expectFrameSamples(renderOutput.visualQuality?.frameSamples)

      expect(renderOutput.subtitleQuality).to.deep.equal({
        cues: 1,
        errors: 0,
        issues: [],
        warnings: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports missing voiceover audio before ffmpeg render', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-render-project-'))

    try {
      await createRenderableProject(root, 'demo')
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'tts-segments.json'),
        `${JSON.stringify([
          {
            duration: 1,
            narrationId: 'narration-1',
            path: 'mock-tts/narration-1.wav',
          },
        ])}\n`,
      )

      const diagnostics = await inspectFfmpegAudio('demo', {workspaceDir: root})

      expect(diagnostics.availableVoiceovers).to.equal(0)
      expect(diagnostics.plan.segments).to.deep.equal([
        {
          alignment: 'narration-id',
          duration: 1,
          index: 0,
          narrationId: 'narration-1',
          path: 'mock-tts/narration-1.wav',
          resolvedPath: join(root, 'projects', 'demo', 'mock-tts', 'narration-1.wav'),
          start: 0,
          status: 'missing',
        },
      ])
      expect(diagnostics.missingVoiceovers).to.deep.equal([
        {
          index: 0,
          narrationId: 'narration-1',
          path: 'mock-tts/narration-1.wav',
          reason: 'missing',
          resolvedPath: join(root, 'projects', 'demo', 'mock-tts', 'narration-1.wav'),
        },
      ])
      expect(diagnostics.warnings).to.deep.equal([
        'No usable audio inputs were found; render will be silent unless the source video already contains audio copied by ffmpeg.',
        '1 TTS voiceover segment(s) were referenced but unavailable.',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('stitches multiple TTS chunks for the same narration segment sequentially', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-render-project-'))

    try {
      await createRenderableProject(root, 'demo')
      await mkdir(join(root, 'projects', 'demo', 'tts'), {recursive: true})
      await Promise.all([
        writeFile(join(root, 'projects', 'demo', 'tts', 'part-1.wav'), 'audio-1'),
        writeFile(join(root, 'projects', 'demo', 'tts', 'part-2.wav'), 'audio-2'),
      ])
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'tts-segments.json'),
        `${JSON.stringify([
          {
            duration: 0.4,
            narrationId: 'narration-1',
            path: 'tts/part-1.wav',
          },
          {
            duration: 0.6,
            narrationId: 'narration-1',
            path: 'tts/part-2.wav',
          },
        ])}\n`,
      )

      const diagnostics = await inspectFfmpegAudio('demo', {workspaceDir: root})

      expect(diagnostics.availableVoiceovers).to.equal(2)
      expect(diagnostics.missingVoiceovers).to.deep.equal([])
      expect(diagnostics.warnings).to.deep.equal([])
      expect(diagnostics.plan.segments).to.deep.equal([
        {
          alignment: 'narration-id',
          duration: 0.4,
          index: 0,
          narrationId: 'narration-1',
          path: 'tts/part-1.wav',
          resolvedPath: join(root, 'projects', 'demo', 'tts', 'part-1.wav'),
          start: 0,
          status: 'available',
        },
        {
          alignment: 'sequential',
          duration: 0.6,
          index: 1,
          narrationId: 'narration-1',
          path: 'tts/part-2.wav',
          resolvedPath: join(root, 'projects', 'demo', 'tts', 'part-2.wav'),
          start: 0.4,
          status: 'available',
        },
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createRenderableProject(root: string, projectId: string): Promise<void> {
  const artifactsDir = join(root, 'projects', projectId, 'artifacts')

  await mkdir(artifactsDir, {recursive: true})
  await Promise.all([
    writeFile(
      join(artifactsDir, 'timeline.json'),
      `${JSON.stringify({
        duration: 1,
        fps: 30,
        items: [],
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'storyboard.json'),
      `${JSON.stringify({
        language: 'zh-CN',
        scenes: [
          {
            duration: 1,
            evidence: [],
            id: 'scene-1',
            narration: 'hello',
            start: 0,
            visualStyle: 'documentary',
          },
        ],
        targetPlatform: 'generic',
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'narration.json'),
      `${JSON.stringify({
        language: 'zh-CN',
        segments: [
          {
            duration: 1,
            id: 'narration-1',
            start: 0,
            text: 'hello',
          },
        ],
        version: 1,
      })}\n`,
    ),
  ])
}

interface TestVisualFrameSample {
  ok: boolean
  path?: string
  sha256?: string
  size?: number
  timestamp: number
}

async function expectFrameSamples(samples: TestVisualFrameSample[] | undefined): Promise<void> {
  expect(samples).to.have.length(3)
  expect(samples?.[0]?.timestamp).to.equal(0)
  expect(samples?.[1]?.timestamp ?? 0).to.be.greaterThan(0)
  expect(samples?.[2]?.timestamp ?? 0).to.be.greaterThan(samples?.[1]?.timestamp ?? 0)

  await Promise.all((samples ?? []).map(async (sample) => {
    expect(sample.ok).to.equal(true)
    expect(sample.path).to.be.a('string')
    expect(sample.sha256).to.match(/^[a-f0-9]{64}$/)
    expect(sample.size).to.be.greaterThan(0)
    expect((await stat(sample.path ?? '')).size).to.equal(sample.size)
  }))
}

async function hasFfmpeg(): Promise<boolean> {
  return (await runProcess(['ffmpeg', '-version'])).code === 0
}

async function hasFfmpegSubtitleFilter(): Promise<boolean> {
  const result = await runProcess(['ffmpeg', '-hide_banner', '-filters'])

  return result.code === 0 && result.stdout.split('\n').some((line) => /\bsubtitles\b/.test(line))
}

import {expect} from 'chai'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runProcess} from '../../packages/media/src/process.js'

describe('cli end-to-end workflow', () => {
  it('inspects, runs, renders, and exports a local media file from CLI commands', async function () {
    this.timeout(60_000)

    if (!(await hasMediaTools())) {
      this.skip()
    }

    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-e2e-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'input.mp4')
    const outputPath = join(root, 'exported.mp4')
    const projectId = 'cli-e2e'

    try {
      await createSampleVideo(inputPath)

      const inspect = await runCliJson<{
        duration?: number
        projectId: string
        streams: number
      }>(['inspect', inputPath, '--project-id', projectId, '--workspace', workspaceDir, '--json'])

      expect(inspect.projectId).to.equal(projectId)
      expect(inspect.streams).to.be.greaterThan(0)
      expect(inspect.duration).to.be.greaterThan(0)

      const run = await runCliJson<{
        artifacts: Record<string, string>
        projectId: string
        status: string
      }>(['run', inputPath, '--project-id', projectId, '--workspace', workspaceDir, '--json'])

      expect(run.projectId).to.equal(projectId)
      expect(run.status).to.equal('completed')
      expect(Object.keys(run.artifacts)).to.include.members(['mediaInfo', 'timeline', 'narration', 'qualityReport'])

      const render = await runCliJson<{
        artifactPath: string
        outputPath: string
        projectId: string
        renderer: string
      }>(['render', projectId, '--workspace', workspaceDir, '--no-audio', '--no-subtitles', '--json'])

      expect(render.projectId).to.equal(projectId)
      expect(render.renderer).to.equal('ffmpeg')
      expect(await fileSize(render.outputPath)).to.be.greaterThan(0)
      expect(await fileSize(render.artifactPath)).to.be.greaterThan(0)

      const exported = await runCliJson<{
        artifactPath: string
        format: string
        outputPath: string
        projectId: string
      }>(['export', projectId, '--workspace', workspaceDir, '--output', outputPath, '--json'])

      expect(exported.projectId).to.equal(projectId)
      expect(exported.format).to.equal('video')
      expect(exported.outputPath).to.equal(outputPath)
      expect(await fileSize(outputPath)).to.be.greaterThan(0)
      expect(await fileSize(exported.artifactPath)).to.be.greaterThan(0)

      const manifest = await runCliJson<{
        checked: number
        ok: boolean
      }>(['artifacts', projectId, '--workspace', workspaceDir, '--verify', '--json'])

      expect(manifest.ok).to.equal(true)
      expect(manifest.checked).to.be.greaterThan(0)

      const status = await runCliJson<{
        job: {status: string}
        summary: {render: {rendered: boolean}}
      }>(['status', projectId, '--workspace', workspaceDir, '--json'])

      expect(status.job.status).to.equal('completed')
      expect(status.summary.render.rendered).to.equal(true)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createSampleVideo(inputPath: string): Promise<void> {
  await expectCommand([
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
    '-c:v',
    'mpeg4',
    inputPath,
  ])
}

async function runCliJson<T>(args: string[]): Promise<T> {
  const result = await expectCommand(['bun', './bin/dev.js', ...args])

  return JSON.parse(result.stdout) as T
}

async function expectCommand(command: string[]): Promise<{stderr: string; stdout: string}> {
  const result = await runProcess(command, {
    cwd: process.cwd(),
    preferBun: false,
  })

  if (result.code !== 0) {
    throw new Error(`Command failed: ${command.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }

  return {
    stderr: result.stderr,
    stdout: result.stdout,
  }
}

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

async function hasMediaTools(): Promise<boolean> {
  try {
    const [ffmpeg, ffprobe] = await Promise.all([runProcess(['ffmpeg', '-version'], {preferBun: false}), runProcess(['ffprobe', '-version'], {preferBun: false})])

    return ffmpeg.code === 0 && ffprobe.code === 0
  } catch {
    return false
  }
}

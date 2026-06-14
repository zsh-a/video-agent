import {expect} from 'chai'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runProcess} from '../../packages/media/src/process.js'

describe('cli end-to-end workflow', () => {
  it('initializes a workspace and validates provider configuration from CLI commands', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-bootstrap-'))
    const workspaceDir = join(root, 'workspace')

    try {
      const init = await runCliJson<{
        checks: Record<string, {status: string}>
        workspaceDir: string
      }>(['init', '--workspace', workspaceDir, '--json'])

      expect(init.workspaceDir).to.equal(workspaceDir)
      expect(init.checks).to.have.keys(['bun', 'config', 'ffmpeg', 'ffprobe', 'projects', 'provider:asr', 'provider:tts', 'provider:vlm', 'workspace'])
      expect(init.checks.workspace.status).to.equal('pass')

      const config = await runCliJson<{
        config: {
          pipeline: {maxStageRetries: number; retryBackoffMs: number}
          providers: {asr: string; tts: string; vlm: string}
        }
        path: string
      }>([
        'config',
        '--asr',
        'mock',
        '--vlm',
        'mock',
        '--tts',
        'mock',
        '--max-stage-retries',
        '2',
        '--retry-backoff-ms',
        '5',
        '--workspace',
        workspaceDir,
        '--json',
      ])

      expect(config.path).to.equal(join(workspaceDir, 'config.json'))
      expect(config.config.providers).to.deep.equal({
        asr: 'mock',
        tts: 'mock',
        vlm: 'mock',
      })
      expect(config.config.pipeline).to.deep.equal({
        maxStageRetries: 2,
        retryBackoffMs: 5,
      })

      const providerEnv = await runCliJson<{
        providers: Array<{provider: string; requirements: unknown[]; role: string}>
      }>(['provider-env', '--workspace', workspaceDir, '--json'])

      expect(providerEnv.providers.map((provider) => `${provider.role}:${provider.provider}`)).to.deep.equal(['asr:mock', 'vlm:mock', 'tts:mock'])
      expect(providerEnv.providers.flatMap((provider) => provider.requirements)).to.deep.equal([])

      const providerTest = await runCliJson<{
        ok: boolean
        results: Array<{provider: string; role: string; status: string}>
      }>(['provider-test', '--workspace', workspaceDir, '--role', 'all', '--json'])

      expect(providerTest.ok).to.equal(true)
      expect(providerTest.results.map((result) => `${result.role}:${result.provider}:${result.status}`)).to.deep.equal([
        'asr:mock:succeeded',
        'vlm:mock:succeeded',
        'tts:mock:succeeded',
      ])

      const doctor = await runCliJson<{
        checks: Array<{name: string; status: string}>
        workspaceDir: string
      }>(['doctor', '--workspace', workspaceDir, '--json'])

      expect(doctor.workspaceDir).to.equal(workspaceDir)
      expect(doctor.checks.find((check) => check.name === 'workspace')?.status).to.equal('pass')
      expect(doctor.checks.find((check) => check.name === 'config')?.status).to.equal('pass')

      await runCliJson(['config', '--asr', 'command', '--workspace', workspaceDir, '--json'])

      const providerTemplate = await runCli(['provider-env', '--workspace', workspaceDir, '--shell-template'])

      expect(providerTemplate.code).to.equal(0)
      expect(providerTemplate.stdout).to.include("export VIDEO_AGENT_ASR_COMMAND='[\"node\",\"./providers/adapter.js\"]'")
      expect(providerTemplate.stdout).to.not.include('VIDEO_AGENT_VLM_COMMAND')

      const failedDoctor = await runCli(['doctor', '--workspace', workspaceDir, '--json'])
      const failedReport = JSON.parse(failedDoctor.stdout) as {
        checks: Array<{message: string; name: string; status: string}>
        ok: boolean
      }

      expect(failedDoctor.code).to.equal(1)
      expect(failedReport.ok).to.equal(false)
      expect(failedReport.checks.find((check) => check.name === 'provider:asr')).to.include({
        status: 'fail',
      })
      expect(failedReport.checks.find((check) => check.name === 'provider:asr')?.message).to.contain('VIDEO_AGENT_ASR_COMMAND')

      await runCliJson(['config', '--asr', 'command', '--vlm', 'command', '--tts', 'command', '--workspace', workspaceDir, '--json'])

      const commandAdapter = JSON.stringify(['bun', 'examples/provider-adapters/mock-json-provider.ts'])
      const commandProviderEnv = {
        VIDEO_AGENT_ASR_COMMAND: commandAdapter,
        VIDEO_AGENT_TTS_COMMAND: commandAdapter,
        VIDEO_AGENT_VLM_COMMAND: commandAdapter,
      }
      const configuredProviderEnv = await runCliJson<{
        providers: Array<{
          requirements: Array<{configured: boolean; env: string; required: boolean}>
          role: string
        }>
      }>(['provider-env', '--workspace', workspaceDir, '--json'], commandProviderEnv)

      expect(configuredProviderEnv.providers.flatMap((provider) => provider.requirements.map((requirement) => `${provider.role}:${requirement.env}:${requirement.configured}`))).to.deep.equal([
        'asr:VIDEO_AGENT_ASR_COMMAND:true',
        'vlm:VIDEO_AGENT_VLM_COMMAND:true',
        'tts:VIDEO_AGENT_TTS_COMMAND:true',
      ])

      const commandProviderTest = await runCliJson<{
        ok: boolean
        results: Array<{
          metadata?: {model?: string; requestId?: string}
          output?: {type: string}
          provider: string
          role: string
          status: string
        }>
      }>(['provider-test', '--workspace', workspaceDir, '--role', 'all', '--json'], commandProviderEnv)

      expect(commandProviderTest.ok).to.equal(true)
      expect(commandProviderTest.results.map((result) => `${result.role}:${result.provider}:${result.status}:${result.metadata?.model}:${result.output?.type}`)).to.deep.equal([
        'asr:command:succeeded:example-command-provider:transcript',
        'vlm:command:succeeded:example-command-provider:scenes',
        'tts:command:succeeded:example-command-provider:tts',
      ])

      const mcpServerEntry = await runCliJson<{
        args: string[]
        command: string
      }>(['mcp', '--print-config', '--client', 'server-entry', '--config-mode', 'installed', '--workspace', workspaceDir])

      expect(mcpServerEntry).to.deep.equal({
        args: ['mcp', '--workspace', workspaceDir],
        command: 'vagent',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

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

async function runCliJson<T>(args: string[], env?: Record<string, string>): Promise<T> {
  const result = await expectCommand(['bun', './bin/dev.js', ...args], env)

  return JSON.parse(result.stdout) as T
}

async function runCli(args: string[]): Promise<{code: number; stderr: string; stdout: string}> {
  return runProcess(['bun', './bin/dev.js', ...args], {
    cwd: process.cwd(),
    preferBun: false,
  })
}

async function expectCommand(command: string[], env?: Record<string, string>): Promise<{stderr: string; stdout: string}> {
  const result = await runProcess(command, {
    cwd: process.cwd(),
    env,
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

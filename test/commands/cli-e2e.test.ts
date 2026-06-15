import {expect} from '#test/expect'
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
        summary: {fail: number; total: number}
        workspaceDir: string
      }>(['init', '--workspace', workspaceDir, '--json'])

      expect(init.workspaceDir).to.equal(workspaceDir)
      expect(init.summary).to.deep.include({
        fail: 0,
        total: 9,
      })
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

      const nonTtyInteractiveConfig = await runCli(['config', '--interactive', '--workspace', workspaceDir])

      expect(nonTtyInteractiveConfig.code).to.equal(1)
      expect(nonTtyInteractiveConfig.stderr).to.include('Interactive config requires a TTY')

      const providerEnv = await runCliJson<{
        providers: Array<{provider: string; requirements: unknown[]; role: string}>
        summary: {configured: number; missing: number; missingRequired: string[]; total: number}
      }>(['provider-env', '--workspace', workspaceDir, '--json'])

      expect(providerEnv.providers.map((provider) => `${provider.role}:${provider.provider}`)).to.deep.equal(['asr:mock', 'vlm:mock', 'tts:mock'])
      expect(providerEnv.providers.flatMap((provider) => provider.requirements)).to.deep.equal([])
      expect(providerEnv.summary).to.deep.include({
        configured: 0,
        missing: 0,
        total: 0,
      })
      expect(providerEnv.summary.missingRequired).to.deep.equal([])

      const providerTest = await runCliJson<{
        ok: boolean
        results: Array<{provider: string; role: string; status: string}>
        summary: {failed: number; succeeded: number; total: number}
      }>(['provider-test', '--workspace', workspaceDir, '--role', 'all', '--json'])

      expect(providerTest.ok).to.equal(true)
      expect(providerTest.summary).to.deep.include({
        failed: 0,
        succeeded: 3,
        total: 3,
      })
      expect(providerTest.results.map((result) => `${result.role}:${result.provider}:${result.status}`)).to.deep.equal([
        'asr:mock:succeeded',
        'vlm:mock:succeeded',
        'tts:mock:succeeded',
      ])

      const doctor = await runCliJson<{
        checks: Array<{name: string; status: string}>
        summary: {fail: number; total: number}
        workspaceDir: string
      }>(['doctor', '--workspace', workspaceDir, '--json'])

      expect(doctor.workspaceDir).to.equal(workspaceDir)
      expect(doctor.summary).to.deep.include({
        fail: 0,
        total: 9,
      })
      expect(doctor.checks.find((check) => check.name === 'workspace')?.status).to.equal('pass')
      expect(doctor.checks.find((check) => check.name === 'config')?.status).to.equal('pass')

      await runCliJson(['config', '--asr', 'command', '--workspace', workspaceDir, '--json'])

      const commandConfig = await runCli(['config', '--workspace', workspaceDir])

      expect(commandConfig.code).to.equal(0)
      expect(commandConfig.stdout).to.include('Provider env: 1 required variable(s) missing: VIDEO_AGENT_ASR_COMMAND')
      expect(commandConfig.stdout).to.include(`Next: bun run dev provider-env --workspace ${workspaceDir} --shell-template`)

      const providerTemplate = await runCli(['provider-env', '--workspace', workspaceDir, '--shell-template'])

      expect(providerTemplate.code).to.equal(0)
      expect(providerTemplate.stdout).to.include("export VIDEO_AGENT_ASR_COMMAND='[\"bun\",\"./providers/adapter.ts\"]'")
      expect(providerTemplate.stdout).to.not.include('VIDEO_AGENT_VLM_COMMAND')

      const failedDoctor = await runCli(['doctor', '--workspace', workspaceDir, '--json'])
      const failedReport = JSON.parse(failedDoctor.stdout) as {
        checks: Array<{message: string; name: string; status: string}>
        ok: boolean
        summary: {fail: number}
      }

      expect(failedDoctor.code).to.equal(1)
      expect(failedReport.ok).to.equal(false)
      expect(failedReport.summary.fail).to.equal(1)
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
      const commandProviderEnvFlags = envFlagArgs(commandProviderEnv)
      const configuredProviderEnv = await runCliJson<{
        providers: Array<{
          requirements: Array<{configured: boolean; env: string; required: boolean}>
          role: string
        }>
        summary: {configured: number; missingRequired: string[]; required: number; total: number}
      }>(['provider-env', ...commandProviderEnvFlags, '--workspace', workspaceDir, '--json'])

      expect(configuredProviderEnv.providers.flatMap((provider) => provider.requirements.map((requirement) => `${provider.role}:${requirement.env}:${requirement.configured}`))).to.deep.equal([
        'asr:VIDEO_AGENT_ASR_COMMAND:true',
        'vlm:VIDEO_AGENT_VLM_COMMAND:true',
        'tts:VIDEO_AGENT_TTS_COMMAND:true',
      ])
      expect(configuredProviderEnv.summary).to.deep.include({
        configured: 3,
        required: 3,
        total: 3,
      })
      expect(configuredProviderEnv.summary.missingRequired).to.deep.equal([])

      const commandProviderTest = await runCliJson<{
        ok: boolean
        results: Array<{
          metadata?: {model?: string; requestId?: string}
          output?: {type: string}
          provider: string
          role: string
          status: string
        }>
        summary: {failed: number; succeeded: number; total: number}
      }>(['provider-test', ...commandProviderEnvFlags, '--workspace', workspaceDir, '--role', 'all', '--json'])

      expect(commandProviderTest.ok).to.equal(true)
      expect(commandProviderTest.summary).to.deep.include({
        failed: 0,
        succeeded: 3,
        total: 3,
      })
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

      const mcpServerEntryInfo = await runCliJson<{
        client: string
        placement: string
        shape: string
      }>(['mcp', '--print-config-info', '--client', 'server-entry', '--workspace', workspaceDir])

      expect(mcpServerEntryInfo).to.include({
        client: 'server-entry',
        shape: 'server',
      })
      expect(mcpServerEntryInfo.placement).to.include('command/args/env')

      const mcpClientPresets = await runCliJson<Array<{
        client: string
        placement: string
        shape: string
      }>>(['mcp', '--list-client-presets', '--workspace', workspaceDir])

      expect(mcpClientPresets.map((preset) => `${preset.client}:${preset.shape}`)).to.deep.equal([
        'generic:full',
        'claude-desktop:full',
        'cursor:full',
        'server-entry:server',
      ])
      expect(mcpClientPresets.at(-1)?.placement).to.include('command/args/env')

      await runCliJson(['config', '--provider-profile', 'mimo', '--workspace', workspaceDir, '--json'])
      const llmProviderEnv = {
        VIDEO_AGENT_LLM_TOKEN: 'secret',
      }
      const llmProviderEnvFlags = envFlagArgs(llmProviderEnv)
      const configuredLLMProviderEnv = await runCliJson<{
        providers: Array<{
          requirements: Array<{configured: boolean; env: string; required: boolean}>
          role: string
        }>
      }>(['provider-env', ...llmProviderEnvFlags, '--workspace', workspaceDir, '--json'])

      expect(configuredLLMProviderEnv.providers.flatMap((provider) => provider.requirements)).to.deep.equal([])

      const llmDoctor = await runCliJson<{
        checks: Array<{name: string; status: string}>
        ok: boolean
      }>(['doctor', ...llmProviderEnvFlags, '--workspace', workspaceDir, '--json'])

      expect(llmDoctor.ok).to.equal(true)
      expect(llmDoctor.checks.filter((check) => check.name.startsWith('provider:')).map((check) => `${check.name}:${check.status}`)).to.include.members([
        'provider:asr:pass',
        'provider:vlm:pass',
        'provider:tts:pass',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('inspects, runs, renders, and exports a local media file from CLI commands', async () => {
    if (!(await hasMediaTools())) {
      return
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

      const run = await expectCommand(['bun', './bin/dev.js', 'run', inputPath, '--project-id', projectId, '--workspace', workspaceDir, '--verbose'])

      expect(run.stdout).to.include('[pipeline] ingest started')
      expect(run.stdout).to.include('[pipeline] quality completed')
      expect(run.stdout).to.include('[provider] asr mock transcribe succeeded')
      expect(run.stdout).to.include('[provider] vlm mock analyzeScenes succeeded')
      expect(run.stdout).to.include('[provider] tts mock synthesize succeeded')
      expect(run.stdout).to.include(`Project: ${projectId}`)
      expect(run.stdout).to.include('Status: completed')

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

function envFlagArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`])
}

async function runCli(args: string[]): Promise<{code: number; stderr: string; stdout: string}> {
  return runProcess(['bun', './bin/dev.js', ...args], {
    cwd: Bun.cwd,
  })
}

async function expectCommand(command: string[], env?: Record<string, string>): Promise<{stderr: string; stdout: string}> {
  const result = await runProcess(command, {
    cwd: Bun.cwd,
    env,
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
    const [ffmpeg, ffprobe] = await Promise.all([runProcess(['ffmpeg', '-version']), runProcess(['ffprobe', '-version'])])

    return ffmpeg.code === 0 && ffprobe.code === 0
  } catch {
    return false
  }
}

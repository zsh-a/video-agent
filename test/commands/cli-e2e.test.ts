import {expect} from '#test/expect'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
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
        total: 10,
      })
      expect(init.checks).to.have.keys(['bun', 'chromium', 'config', 'ffmpeg', 'ffprobe', 'projects', 'provider:asr', 'provider:tts', 'provider:vlm', 'workspace'])
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
        total: 10,
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


  it('fails Film Recap semantic stages clearly when no LLM is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-film-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'episode.mp4')
    const projectId = 'cli-film'

    try {
      await createSampleVideoWithAudio(inputPath)

      const film = await runCli(['film', inputPath, '--project-id', projectId, '--workspace', workspaceDir, '--target', '500ms', '--json'])

      expect(film.code).to.equal(1)
      expect(film.stderr).to.include('Film Recap story indexing requires an LLM provider')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails Deck Explainer text planning clearly when no LLM is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-deck-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'deck.md')
    const projectId = 'cli-deck'

    try {
      await writeFile(
        inputPath,
        [
          '视频 Agent 应该拆成两个业务 pipeline。电影解说以素材为中心，PPT 讲解以结构为中心。',
          '',
          '两条 pipeline 共用 runtime、provider、media、renderer 和 quality 层。',
        ].join('\n'),
      )
      const deckProject = await runCli([
        'deck',
        inputPath,
        '--mode',
        'script-generated',
        '--project-id',
        projectId,
        '--workspace',
        workspaceDir,
        '--duration',
        '2m',
        '--format',
        'landscape',
        '--style',
        'tech-gradient',
        '--content-density',
        'detailed',
        '--max-slide-characters',
        '45',
        '--json',
      ])

      expect(deckProject.code).to.equal(1)
      expect(deckProject.stderr).to.include('Deck explainer planning requires an LLM provider')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails Deck CLI without an explicit mode instead of defaulting to script-generated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-deck-mode-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'deck.md')

    try {
      await writeFile(inputPath, 'Deck mode must be explicit.')

      const deckProject = await runCli([
        'deck',
        inputPath,
        '--workspace',
        workspaceDir,
        '--json',
      ])

      expect(deckProject.code).to.equal(1)
      expect(deckProject.stderr).to.include('Deck command requires --mode')
      expect(deckProject.stderr).to.include('no CLI script-generated fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails audio-anchored Deck planning clearly when no LLM is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-deck-audio-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'podcast.wav')
    const projectId = 'cli-deck-audio'

    try {
      await createSampleAudio(inputPath)

      const deckProject = await runCli([
        'deck',
        inputPath,
        '--mode',
        'audio-anchored',
        '--project-id',
        projectId,
        '--workspace',
        workspaceDir,
        '--format',
        'square',
        '--style',
        'tech-gradient',
        '--json',
      ])

      expect(deckProject.code).to.equal(1)
      expect(deckProject.stderr).to.include('Deck audio-anchored planning requires an LLM provider')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('fails summarized Deck planning clearly when no LLM is configured', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-deck-summary-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'podcast.wav')
    const projectId = 'cli-deck-summary'

    try {
      await createSampleAudio(inputPath)

      const deckProject = await runCli([
        'deck',
        inputPath,
        '--mode',
        'summarize',
        '--duration',
        '2s',
        '--project-id',
        projectId,
        '--workspace',
        workspaceDir,
        '--json',
      ])

      expect(deckProject.code).to.equal(1)
      expect(deckProject.stderr).to.include('Deck audio summary planning requires an LLM provider')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createSampleVideoWithAudio(inputPath: string): Promise<void> {
  await expectCommand([
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
    'sine=frequency=440:sample_rate=48000',
    '-t',
    '1',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'mpeg4',
    '-c:a',
    'aac',
    inputPath,
  ])
}

async function createSampleAudio(inputPath: string): Promise<void> {
  await expectCommand([
    'ffmpeg',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=1000:sample_rate=48000',
    '-t',
    '1',
    '-ac',
    '2',
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

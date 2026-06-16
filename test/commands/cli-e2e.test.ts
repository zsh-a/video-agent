import {expect} from '#test/expect'
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
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
      }>(['render', projectId, '--workspace', workspaceDir, '--renderer', 'ffmpeg', '--no-audio', '--no-subtitles', '--json'])

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

  it('runs a complete Film Recap pipeline from video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-film-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'episode.mp4')
    const projectId = 'cli-film'

    try {
      await createSampleVideo(inputPath)

      const film = await runCliJson<{
        clipPlan: {clips: number; duration: number}
        finalRender: {outputPath: string; status: string}
        ingest: {
          artifacts: {sourceManifest: string}
          sourceManifest: {duration: number; orientation: string; sourceHash: string}
        }
        projectId: string
        quality: {qualityReport: {summary: {errors: number}}}
        status: string
      }>(['film', inputPath, '--project-id', projectId, '--workspace', workspaceDir, '--target', '500ms', '--json'])

      expect(film.projectId).to.equal(projectId)
      expect(film.status).to.equal('completed')
      expect(film.ingest.sourceManifest.duration).to.be.greaterThan(0)
      expect(film.ingest.sourceManifest.orientation).to.equal('landscape')
      expect(film.ingest.sourceManifest.sourceHash.length).to.equal(64)
      expect(film.clipPlan.duration).to.equal(0.5)
      expect(film.finalRender.status).to.equal('rendered')
      expect(film.quality.qualityReport.summary.errors).to.equal(0)
      expect(await fileSize(film.ingest.artifacts.sourceManifest)).to.be.greaterThan(0)
      expect(await fileSize(film.finalRender.outputPath)).to.be.greaterThan(0)

      const understand = await runCliJson<{
        artifacts: {frames: string; timelineFusion: string}
        projectId: string
        scenes: number
        status: string
      }>(['film', 'understand', projectId, '--workspace', workspaceDir, '--json'])

      expect(understand.projectId).to.equal(projectId)
      expect(understand.status).to.equal('understood')
      expect(understand.scenes).to.equal(1)
      expect(await fileSize(understand.artifacts.timelineFusion)).to.be.greaterThan(0)

      const storyIndex = await runCliJson<{
        artifacts: {storyIndex: string}
        beats: number
        projectId: string
        status: string
      }>(['film', 'build-story-index', projectId, '--workspace', workspaceDir, '--json'])

      expect(storyIndex.projectId).to.equal(projectId)
      expect(storyIndex.status).to.equal('indexed')
      expect(storyIndex.beats).to.equal(1)
      expect(await fileSize(storyIndex.artifacts.storyIndex)).to.be.greaterThan(0)

      const clipPlan = await runCliJson<{
        artifacts: {clipPlan: string}
        clips: number
        duration: number
        projectId: string
        status: string
      }>(['film', 'plan-clips', projectId, '--workspace', workspaceDir, '--target', '500ms', '--json'])

      expect(clipPlan.projectId).to.equal(projectId)
      expect(clipPlan.status).to.equal('planned')
      expect(clipPlan.clips).to.equal(1)
      expect(clipPlan.duration).to.equal(0.5)
      expect(await fileSize(clipPlan.artifacts.clipPlan)).to.be.greaterThan(0)

      const cut = await runCliJson<{
        artifacts: {outputTimelineMap: string}
        outputPath: string
        projectId: string
        status: string
      }>(['film', 'cut', projectId, '--workspace', workspaceDir, '--json'])

      expect(cut.projectId).to.equal(projectId)
      expect(cut.status).to.equal('cut')
      expect(await fileSize(cut.outputPath)).to.be.greaterThan(0)
      expect(await fileSize(cut.artifacts.outputTimelineMap)).to.be.greaterThan(0)

      const narration = await runCliJson<{
        artifacts: {narration: string; outputNarration: string}
        projectId: string
        segments: number
        status: string
      }>(['film', 'narrate', projectId, '--workspace', workspaceDir, '--json'])

      expect(narration.projectId).to.equal(projectId)
      expect(narration.status).to.equal('narrated')
      expect(narration.segments).to.equal(1)
      expect(await fileSize(narration.artifacts.outputNarration)).to.be.greaterThan(0)
      expect(await fileSize(narration.artifacts.narration)).to.be.greaterThan(0)

      const voice = await runCliJson<{
        artifacts: {ttsSegments: string}
        projectId: string
        segments: number
        status: string
      }>(['film', 'synthesize-voice', projectId, '--workspace', workspaceDir, '--json'])

      expect(voice.projectId).to.equal(projectId)
      expect(voice.status).to.equal('voiced')
      expect(voice.segments).to.equal(1)
      expect(await fileSize(voice.artifacts.ttsSegments)).to.be.greaterThan(0)

      const audioMix = await runCliJson<{
        artifacts: {audioMix: string}
        outputPath: string
        projectId: string
        status: string
      }>(['film', 'mix-audio', projectId, '--workspace', workspaceDir, '--json'])

      expect(audioMix.projectId).to.equal(projectId)
      expect(audioMix.status).to.equal('mixed')
      expect(await fileSize(audioMix.artifacts.audioMix)).to.be.greaterThan(0)
      expect(await fileSize(audioMix.outputPath)).to.be.greaterThan(44)

      const subtitle = await runCliJson<{
        artifacts: {subtitles: string}
        outputPath: string
        projectId: string
        status: string
      }>(['film', 'subtitle', projectId, '--workspace', workspaceDir, '--json'])

      expect(subtitle.projectId).to.equal(projectId)
      expect(subtitle.status).to.equal('subtitled')
      expect(await fileSize(subtitle.artifacts.subtitles)).to.be.greaterThan(0)
      expect(await fileSize(subtitle.outputPath)).to.be.greaterThan(0)

      const rendered = await runCliJson<{
        artifactPath: string
        outputPath: string
        projectId: string
        renderer: string
        status: string
      }>(['film', 'render', projectId, '--workspace', workspaceDir, '--json'])

      expect(rendered.projectId).to.equal(projectId)
      expect(rendered.status).to.equal('rendered')
      expect(rendered.renderer).to.equal('ffmpeg')
      expect(await fileSize(rendered.artifactPath)).to.be.greaterThan(0)
      expect(await fileSize(rendered.outputPath)).to.be.greaterThan(0)

      const quality = await runCliJson<{
        artifactPath: string
        projectId: string
        qualityReport: {summary: {errors: number}}
        status: string
      }>(['film', 'quality-check', projectId, '--workspace', workspaceDir, '--json'])

      expect(quality.projectId).to.equal(projectId)
      expect(quality.status).to.equal('checked')
      expect(quality.qualityReport.summary.errors).to.equal(0)
      expect(await fileSize(quality.artifactPath)).to.be.greaterThan(0)

      const manifest = await runCliJson<{
        checked: number
        ok: boolean
      }>(['artifacts', projectId, '--workspace', workspaceDir, '--verify', '--json'])

      expect(manifest.ok).to.equal(true)
      expect(manifest.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates a Deck Explainer project from text with DeckIR artifacts', async () => {
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
      const chromiumCommand = await createFakeChromiumCommand(root)

      const deckProject = await runCliJson<{
        deck: {
          artifacts: {deck: string; document: string; timedDeck: string}
          slides: number
          status: string
        }
        finalRender: {htmlEntryPath: string; outputPath: string; status: string}
        projectId: string
        status: string
        voiceover?: {duration: number; outputPath: string; status: string}
      }>([
        'deck',
        inputPath,
        '--project-id',
        projectId,
        '--workspace',
        workspaceDir,
        '--duration',
        '2m',
        '--format',
        'landscape',
        '--style',
        'tech',
        '--max-slide-characters',
        '45',
        '--chromium-command',
        JSON.stringify(chromiumCommand),
        '--json',
      ])

      expect(deckProject.projectId).to.equal(projectId)
      expect(deckProject.deck.slides).to.be.greaterThan(1)
      expect(deckProject.status).to.equal('completed')
      expect(deckProject.deck.status).to.equal('completed')
      expect(deckProject.voiceover?.status).to.equal('voiced')
      expect(deckProject.finalRender.status).to.equal('rendered')
      expect(await fileSize(deckProject.finalRender.htmlEntryPath)).to.be.greaterThan(0)
      expect(await fileSize(deckProject.finalRender.outputPath)).to.be.greaterThan(0)

      const deck = JSON.parse(await readFile(deckProject.deck.artifacts.deck, 'utf8')) as {
        format: string
        slides: Array<{slideId: string}>
        theme: string
      }
      const timedDeck = JSON.parse(await readFile(deckProject.deck.artifacts.timedDeck, 'utf8')) as {
        timings: Array<{end: number; slideId: string; start: number}>
      }

      expect(deck.format).to.equal('landscape_1920x1080')
      expect(deck.theme).to.equal('tech')
      expect(timedDeck.timings.length).to.equal(deck.slides.length)
      expect(timedDeck.timings[0]?.start).to.equal(0)
      expect(timedDeck.timings.at(-1)?.end).to.equal(deckProject.voiceover?.duration)

      const deckVoice = await runCliJson<{
        artifacts: {deckVoiceover: string; timedDeck: string; ttsSegments: string}
        duration: number
        outputPath: string
        projectId: string
        slides: number
        status: string
      }>(['deck', 'synthesize-voice', projectId, '--workspace', workspaceDir, '--json'])

      expect(deckVoice.projectId).to.equal(projectId)
      expect(deckVoice.status).to.equal('voiced')
      expect(deckVoice.slides).to.equal(deck.slides.length)
      expect(deckVoice.duration).to.be.greaterThan(0)
      expect(await fileSize(deckVoice.artifacts.deckVoiceover)).to.be.greaterThan(0)
      expect(await fileSize(deckVoice.artifacts.ttsSegments)).to.be.greaterThan(0)
      expect(await fileSize(deckVoice.outputPath)).to.be.greaterThan(44)

      const voicedTimedDeck = JSON.parse(await readFile(deckVoice.artifacts.timedDeck, 'utf8')) as {
        audioRef?: string
        timings: Array<{end: number; slideId: string; start: number}>
      }

      expect(voicedTimedDeck.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(voicedTimedDeck.timings[0]?.start).to.equal(0)
      expect(voicedTimedDeck.timings.at(-1)?.end).to.equal(deckVoice.duration)

      const htmlRendererScript = join(root, 'fake-html-renderer.ts')
      const htmlCapturePath = join(root, 'html-capture.mp4')

      await writeFile(
        htmlRendererScript,
        [
          "const args = Bun.argv.slice(2)",
          "if (args[0] === 'validate') {",
          "  await Bun.file(`${args[1]}/index.html`).text()",
          "  console.log('validated')",
          "  process.exit(0)",
          "}",
          "if (args[0] === 'render') {",
          "  const outputPath = args[args.indexOf('--output') + 1]",
          "  await Bun.write(outputPath, 'fake html capture')",
          "  console.log('rendered')",
          "  process.exit(0)",
          "}",
          "process.exit(2)",
          '',
        ].join('\n'),
      )
      const deckRender = await runCliJson<{
        artifactPath: string
        frameRenderer: string
        frameCount: number
        htmlEntryPath: string
        outputPath: string
        projectId: string
        rendered?: {stdout: string}
        renderer: string
        status: string
        validation?: {stdout: string}
        videoRenderer: string
      }>([
        'deck',
        'render',
        projectId,
        '--workspace',
        workspaceDir,
        '--chromium-command',
        JSON.stringify(chromiumCommand),
        '--html-render-command',
        JSON.stringify(['bun', htmlRendererScript]),
        '--html-output',
        htmlCapturePath,
        '--html-render',
        '--html-validate',
        '--json',
      ])

      expect(deckRender.projectId).to.equal(projectId)
      expect(deckRender.status).to.equal('rendered')
      expect(deckRender.renderer).to.equal('html')
      expect(deckRender.frameRenderer).to.equal('chromium')
      expect(deckRender.videoRenderer).to.equal('chromium+ffmpeg')
      expect(deckRender.rendered?.stdout).to.contain('rendered')
      expect(deckRender.validation?.stdout).to.contain('validated')
      expect(deckRender.frameCount).to.equal(deck.slides.length)
      expect(await fileSize(deckRender.artifactPath)).to.be.greaterThan(0)
      expect(await fileSize(deckRender.htmlEntryPath)).to.be.greaterThan(0)
      expect(await fileSize(htmlCapturePath)).to.be.greaterThan(0)
      expect(await fileSize(deckRender.outputPath)).to.be.greaterThan(0)

      const deckExport = await runCliJson<{
        format: string
        outputPath: string
      }>(['export', projectId, '--workspace', workspaceDir, '--output', join(root, 'deck-final.mp4'), '--json'])

      expect(deckExport.format).to.equal('video')
      expect(await fileSize(deckExport.outputPath)).to.be.greaterThan(0)

      const manifest = await runCliJson<{
        checked: number
        ok: boolean
      }>(['artifacts', projectId, '--workspace', workspaceDir, '--verify', '--json'])

      expect(manifest.ok).to.equal(true)
      expect(manifest.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates an audio-anchored Deck Explainer project and renders final video', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-deck-audio-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'podcast.wav')
    const projectId = 'cli-deck-audio'

    try {
      await createSampleAudio(inputPath)
      const chromiumCommand = await createFakeChromiumCommand(root)

      const deckProject = await runCliJson<{
        deck: {
          artifacts: {deck: string; timedDeck: string; transcript: string}
          duration: number
          outputPath: string
          slides: number
          status: string
        }
        finalRender: {outputPath: string; status: string}
        projectId: string
        status: string
      }>([
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
        'tech',
        '--chromium-command',
        JSON.stringify(chromiumCommand),
        '--json',
      ])

      expect(deckProject.projectId).to.equal(projectId)
      expect(deckProject.status).to.equal('completed')
      expect(deckProject.deck.status).to.equal('completed')
      expect(deckProject.finalRender.status).to.equal('rendered')
      expect(deckProject.deck.duration).to.be.greaterThan(0)
      expect(deckProject.deck.slides).to.be.greaterThan(0)
      expect(await fileSize(deckProject.deck.outputPath)).to.be.greaterThan(44)
      expect(await fileSize(deckProject.finalRender.outputPath)).to.be.greaterThan(0)

      const deck = JSON.parse(await readFile(deckProject.deck.artifacts.deck, 'utf8')) as {
        format: string
        inputMode: string
      }
      const timedDeck = JSON.parse(await readFile(deckProject.deck.artifacts.timedDeck, 'utf8')) as {
        audioRef?: string
        timings: Array<{end: number; start: number}>
      }

      expect(deck.format).to.equal('square_1080x1080')
      expect(deck.inputMode).to.equal('audio-anchored')
      expect(timedDeck.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(timedDeck.timings[0]?.start).to.equal(0)
      expect(timedDeck.timings.at(-1)?.end).to.equal(deckProject.deck.duration)

      const deckRender = await runCliJson<{
        artifactPath: string
        htmlEntryPath: string
        outputPath: string
        projectId: string
        renderer: string
        status: string
        videoRenderer: string
      }>(['deck', 'render', projectId, '--workspace', workspaceDir, '--chromium-command', JSON.stringify(await createFakeChromiumCommand(root)), '--json'])

      expect(deckRender.projectId).to.equal(projectId)
      expect(deckRender.status).to.equal('rendered')
      expect(deckRender.renderer).to.equal('html')
      expect(deckRender.videoRenderer).to.equal('chromium+ffmpeg')
      expect(await fileSize(deckRender.artifactPath)).to.be.greaterThan(0)
      expect(await fileSize(deckRender.htmlEntryPath)).to.be.greaterThan(0)
      expect(await fileSize(deckRender.outputPath)).to.be.greaterThan(0)

      const exported = await runCliJson<{
        format: string
        outputPath: string
      }>(['export', projectId, '--workspace', workspaceDir, '--output', join(root, 'audio-deck.mp4'), '--json'])

      expect(exported.format).to.equal('video')
      expect(await fileSize(exported.outputPath)).to.be.greaterThan(0)

      const manifest = await runCliJson<{
        checked: number
        ok: boolean
      }>(['artifacts', projectId, '--workspace', workspaceDir, '--verify', '--json'])

      expect(manifest.ok).to.equal(true)
      expect(manifest.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates a summarized Deck Explainer from audio and renders with new narration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-cli-deck-summary-'))
    const workspaceDir = join(root, 'workspace')
    const inputPath = join(root, 'podcast.wav')
    const projectId = 'cli-deck-summary'

    try {
      await createSampleAudio(inputPath)
      const chromiumCommand = await createFakeChromiumCommand(root)

      const deckProject = await runCliJson<{
        deck: {
          artifacts: {deck: string; speakerScript: string; transcript: string}
          slides: number
          sourceMode: string
          status: string
        }
        finalRender: {outputPath: string; status: string}
        projectId: string
        status: string
        voiceover?: {outputPath: string; status: string}
      }>([
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
        '--chromium-command',
        JSON.stringify(chromiumCommand),
        '--json',
      ])

      expect(deckProject.projectId).to.equal(projectId)
      expect(deckProject.status).to.equal('completed')
      expect(deckProject.deck.status).to.equal('completed')
      expect(deckProject.deck.sourceMode).to.equal('audio-summary')
      expect(deckProject.deck.slides).to.be.greaterThan(0)
      expect(deckProject.voiceover?.status).to.equal('voiced')
      expect(deckProject.finalRender.status).to.equal('rendered')
      expect(await fileSize(deckProject.voiceover?.outputPath ?? '')).to.be.greaterThan(44)
      expect(await fileSize(deckProject.finalRender.outputPath)).to.be.greaterThan(0)

      const deck = JSON.parse(await readFile(deckProject.deck.artifacts.deck, 'utf8')) as {inputMode: string}
      const speakerScript = JSON.parse(await readFile(deckProject.deck.artifacts.speakerScript, 'utf8')) as {mode: string}
      const transcript = JSON.parse(await readFile(deckProject.deck.artifacts.transcript, 'utf8')) as {text: string}

      expect(deck.inputMode).to.equal('script-generated')
      expect(speakerScript.mode).to.equal('script-generated')
      expect(transcript.text).to.contain('Mock transcript')

      const voice = await runCliJson<{
        outputPath: string
        status: string
      }>(['deck', 'synthesize-voice', projectId, '--workspace', workspaceDir, '--json'])

      expect(voice.status).to.equal('voiced')
      expect(await fileSize(voice.outputPath)).to.be.greaterThan(44)

      const render = await runCliJson<{
        htmlEntryPath: string
        outputPath: string
        renderer: string
        status: string
        videoRenderer: string
      }>(['deck', 'render', projectId, '--workspace', workspaceDir, '--chromium-command', JSON.stringify(await createFakeChromiumCommand(root)), '--json'])

      expect(render.status).to.equal('rendered')
      expect(render.renderer).to.equal('html')
      expect(render.videoRenderer).to.equal('chromium+ffmpeg')
      expect(await fileSize(render.htmlEntryPath)).to.be.greaterThan(0)
      expect(await fileSize(render.outputPath)).to.be.greaterThan(0)

      const manifest = await runCliJson<{
        checked: number
        ok: boolean
      }>(['artifacts', projectId, '--workspace', workspaceDir, '--verify', '--json'])

      expect(manifest.ok).to.equal(true)
      expect(manifest.checked).to.be.greaterThan(0)
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

async function createFakeChromiumCommand(root: string): Promise<string[]> {
  const scriptPath = join(root, `fake-chromium-${cryptoRandomLabel()}.ts`)

  await writeFile(
    scriptPath,
    [
      'const screenshotArg = Bun.argv.find((arg) => arg.startsWith("--screenshot="))',
      'if (screenshotArg === undefined) {',
      '  console.error("missing screenshot output")',
      '  process.exit(2)',
      '}',
      'const outputPath = screenshotArg.slice("--screenshot=".length)',
      'const ppm = new Uint8Array([',
      '  80, 54, 10, 50, 32, 50, 10, 50, 53, 53, 10,',
      '  255, 255, 255, 37, 99, 235, 15, 23, 42, 249, 115, 22,',
      '])',
      'await Bun.write(outputPath, ppm)',
      '',
    ].join('\n'),
  )

  return ['bun', scriptPath]
}

function cryptoRandomLabel(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
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

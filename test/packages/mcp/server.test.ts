import {expect} from '#test/expect'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {createVideoAgentMcpServer} from '../../../packages/mcp/src/server.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {writeConfig} from '../../../packages/runtime/src/config.js'

describe('mcp server', () => {
  it('lists video-agent tools', async () => {
    const server = createVideoAgentMcpServer()
    const response = await server.handleMessage({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/list',
    })

    expect(response?.result).to.have.property('tools')
    expect((response?.result as {tools: Array<{name: string}>}).tools.map((tool) => tool.name)).to.include.members([
      'video_agent_list_projects',
      'video_agent_quality',
      'video_agent_provider_env',
      'video_agent_provider_test',
      'video_agent_guided_actions',
	      'video_agent_visual_samples',
	      'video_agent_status',
	      'video_agent_rerun',
      'video_agent_deck_export_backend',
      'video_agent_deck_plan_shards',
      'video_agent_deck_render',
      'video_agent_deck_render_backend',
      'video_agent_deck_run_shards',
      'video_agent_worker',
    ])
  })

  it('describes extended render and audio tool options', () => {
    const server = createVideoAgentMcpServer()
    const toolsByName = new Map(server.tools.map((tool) => [tool.name, tool]))
    const renderProperties = toolsByName.get('video_agent_render')?.inputSchema.properties ?? {}
    const audioProperties = toolsByName.get('video_agent_inspect_audio')?.inputSchema.properties ?? {}
    const workerProperties = toolsByName.get('video_agent_worker')?.inputSchema.properties ?? {}
    const qualityProperties = toolsByName.get('video_agent_quality')?.inputSchema.properties ?? {}
    const exportProperties = toolsByName.get('video_agent_export')?.inputSchema.properties ?? {}
    const deckRenderProperties = toolsByName.get('video_agent_deck_render')?.inputSchema.properties ?? {}
    const deckBackendProperties = toolsByName.get('video_agent_deck_export_backend')?.inputSchema.properties ?? {}
    const deckRenderBackendProperties = toolsByName.get('video_agent_deck_render_backend')?.inputSchema.properties ?? {}
    const deckRunShardProperties = toolsByName.get('video_agent_deck_run_shards')?.inputSchema.properties ?? {}

    expect(Object.keys(renderProperties)).to.include.members(['duckingThreshold', 'sourceVolume', 'voiceoverVolume'])
    expect(Object.keys(deckRenderProperties)).to.include.members(['chromiumCommand', 'finalizeOnly', 'frameCaptureBackend', 'frameStart', 'frameEnd', 'keyframeCaptureBackend', 'playwrightCommand'])
    expect(Object.keys(deckBackendProperties)).to.include.members(['backend', 'compositionId', 'fps', 'outputDir'])
    expect(Object.keys(deckRenderBackendProperties)).to.include.members(['backend', 'command', 'compositionId', 'outputPath'])
    expect(Object.keys(deckRunShardProperties)).to.include.members(['frameCaptureBackend', 'frameConcurrency', 'frameShardSize', 'playwrightCommand', 'shardConcurrency', 'shardRetries', 'shardRetryDelayMs'])
    expect(Object.keys(audioProperties)).to.include.members(['duckingAttackMs', 'duckingRatio', 'duckingReleaseMs', 'duckingThreshold', 'sourceVolume', 'voiceoverVolume'])
    expect(Object.keys(workerProperties)).to.include.members(['dryRun', 'limit', 'maxAttempts', 'orderBy', 'runningStaleAfterMs', 'status'])
    expect(Object.keys(qualityProperties)).to.include('details')
    expect(Object.keys(exportProperties)).to.include('cleanOutput')
  })

  it('adds client-facing descriptions to important tool arguments', () => {
    const server = createVideoAgentMcpServer()
    const toolsByName = new Map(server.tools.map((tool) => [tool.name, tool]))
    const renderProperties = toolsByName.get('video_agent_render')?.inputSchema.properties as Record<string, {description?: string}> | undefined
    const workerProperties = toolsByName.get('video_agent_worker')?.inputSchema.properties as Record<string, {description?: string}> | undefined
	    const deckShardProperties = toolsByName.get('video_agent_deck_plan_shards')?.inputSchema.properties as Record<string, {description?: string}> | undefined
    const deckRunShardProperties = toolsByName.get('video_agent_deck_run_shards')?.inputSchema.properties as Record<string, {description?: string}> | undefined
    const guidedActionProperties = toolsByName.get('video_agent_guided_actions')?.inputSchema.properties as Record<string, {description?: string}> | undefined

    expect(guidedActionProperties?.artifactLimit.description).to.include('Maximum number of project artifacts')
    expect(renderProperties?.projectId.description).to.equal('Project id inside the video-agent workspace.')
    expect(renderProperties?.audio.description).to.include('render without source or voiceover audio')
    expect(workerProperties?.runningStaleAfterMs.description).to.include('Skip running jobs')
    expect(workerProperties?.orderBy.description).to.include('Recovery candidate ordering')
	    expect(deckShardProperties?.frameShardSize.description).to.include('Frame count per planned shard')
	    expect(deckRunShardProperties?.shardConcurrency.description).to.include('Maximum shards')
	    expect(guidedActionProperties?.commandPrefix.description).to.include('Command prefix')
	  })

  it('calls runtime tools and returns text content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'status-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            projectId: 'demo',
          },
          name: 'video_agent_status',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const [firstContent] = content
      const status = JSON.parse(firstContent?.text ?? '{}') as {projectId: string; summary: {quality: {issues: number}}}

      expect(firstContent?.type).to.equal('text')
      expect(status.projectId).to.equal('demo')
      expect(status.summary.quality.issues).to.equal(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('can include raw quality details from the quality tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')
      await writeQualityArtifacts(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'quality-details-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            details: true,
            projectId: 'demo',
          },
          name: 'video_agent_quality',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const report = JSON.parse(content[0]?.text ?? '{}') as {qualityReport?: {summary: {errors: number}}; renderOutput?: {renderer: string}}

      expect(report.qualityReport?.summary.errors).to.equal(1)
      expect(report.renderOutput?.renderer).to.equal('ffmpeg')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses explicit provider env values for doctor checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))
    const command = '["bun","examples/provider-adapters/mock-json-provider.ts"]'

    try {
      await createProject(root, 'demo')
      await writeConfig(root, {asr: 'command'})

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'doctor-explicit-env-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            env: {
              VIDEO_AGENT_ASR_COMMAND: command,
            },
          },
          name: 'video_agent_doctor',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const report = JSON.parse(content[0]?.text ?? '{}') as {checks: Array<{name: string; status: string}>; ok: boolean; summary: {fail: number}}

      expect(report.ok).to.equal(true)
      expect(report.summary.fail).to.equal(0)
      expect(report.checks.find((check) => check.name === 'provider:asr')).to.include({
        name: 'provider:asr',
        status: 'pass',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('calls the provider environment tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'provider-env-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {},
          name: 'video_agent_provider_env',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {providers: Array<{provider: string; role: string}>; summary: {total: number}}

      expect(result.providers.map((provider) => `${provider.role}:${provider.provider}`)).to.deep.equal(['asr:mock', 'vlm:mock', 'tts:mock'])
      expect(result.summary.total).to.equal(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('can include provider environment shell templates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')
      await writeConfig(root, {asr: 'command'})

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'provider-env-template-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            shellTemplate: true,
          },
          name: 'video_agent_provider_env',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {shellTemplate: string}

      expect(result.shellTemplate).to.include("export VIDEO_AGENT_ASR_COMMAND='[\"bun\",\"./providers/adapter.ts\"]'")
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses explicit provider env values for environment reports and smoke tests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))
    const command = '["bun","examples/provider-adapters/mock-json-provider.ts"]'

    try {
      await createProject(root, 'demo')
      await writeConfig(root, {
        asr: 'command',
        tts: 'command',
        vlm: 'command',
      })

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const providerEnvResponse = await server.handleMessage({
        id: 'provider-env-explicit-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            env: {
              VIDEO_AGENT_ASR_COMMAND: command,
              VIDEO_AGENT_TTS_COMMAND: command,
              VIDEO_AGENT_VLM_COMMAND: command,
            },
          },
          name: 'video_agent_provider_env',
        },
      })
      const providerEnvContent = providerEnvResponse?.result as {content: Array<{text: string; type: string}>}
      const providerEnv = JSON.parse(providerEnvContent.content[0]?.text ?? '{}') as {
        providers: Array<{
          requirements: Array<{configured: boolean; env: string}>
          role: string
        }>
        summary: {configured: number; missingRequired: string[]}
      }

      expect(providerEnv.providers.flatMap((provider) => provider.requirements.map((requirement) => `${provider.role}:${requirement.env}:${requirement.configured}`))).to.deep.equal([
        'asr:VIDEO_AGENT_ASR_COMMAND:true',
        'vlm:VIDEO_AGENT_VLM_COMMAND:true',
        'tts:VIDEO_AGENT_TTS_COMMAND:true',
      ])
      expect(providerEnv.summary.configured).to.equal(3)
      expect(providerEnv.summary.missingRequired).to.deep.equal([])
      expect(JSON.stringify(providerEnv)).to.not.include(command)

      const providerTestResponse = await server.handleMessage({
        id: 'provider-test-explicit-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            env: {
              VIDEO_AGENT_ASR_COMMAND: command,
              VIDEO_AGENT_TTS_COMMAND: command,
              VIDEO_AGENT_VLM_COMMAND: command,
            },
            role: 'all',
          },
          name: 'video_agent_provider_test',
        },
      })
      const providerTestContent = providerTestResponse?.result as {content: Array<{text: string; type: string}>}
      const providerTest = JSON.parse(providerTestContent.content[0]?.text ?? '{}') as {
        ok: boolean
        results: Array<{metadata?: {model?: string}; output?: {type: string}; provider: string; role: string; status: string}>
        summary: {failed: number; succeeded: number; total: number}
      }

      expect(providerTest.ok).to.equal(true)
      expect(providerTest.summary).to.deep.include({
        failed: 0,
        succeeded: 3,
        total: 3,
      })
      expect(providerTest.results.map((result) => `${result.role}:${result.provider}:${result.status}:${result.metadata?.model}:${result.output?.type}`)).to.deep.equal([
        'asr:command:succeeded:example-command-provider:transcript',
        'vlm:command:succeeded:example-command-provider:scenes',
        'tts:command:succeeded:example-command-provider:tts',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('calls the provider smoke test tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'provider-test-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            role: 'asr',
          },
          name: 'video_agent_provider_test',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {ok: boolean; results: Array<{provider: string; role: string; status: string}>; summary: {failed: number; succeeded: number; total: number}}

      expect(result.ok).to.equal(true)
      expect(result.summary).to.deep.include({
        failed: 0,
        succeeded: 1,
        total: 1,
      })
      expect(result.results.find((item) => item.role === 'asr')).to.include({
        provider: 'mock',
        role: 'asr',
        status: 'succeeded',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('calls the guided actions tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'guided-actions-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            artifactLimit: 0,
            commandPrefix: 'bun run dev',
            projectId: 'demo',
          },
          name: 'video_agent_guided_actions',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {actions: Array<{category: string; command: string; id: string}>; projectId: string}

      expect(result.projectId).to.equal('demo')
      expect(result.actions.map((action) => action.id)).to.not.include('open-artifact')
      expect(result.actions.find((action) => action.id === 'inspect-status')).to.include({
        category: 'inspect',
        command: `bun run dev tui --project demo --action status --workspace ${root}`,
        id: 'inspect-status',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('calls the events tool with pipeline filters', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'pipeline-events.jsonl'),
        [
          JSON.stringify({projectId: 'demo', stage: 'ingest', time: '2026-01-01T00:00:00.000Z', type: 'stage:start'}),
          JSON.stringify({projectId: 'demo', stage: 'quality', time: '2026-01-01T00:00:01.000Z', type: 'stage:complete'}),
        ].join('\n'),
      )

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'events-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            kind: 'pipeline',
            projectId: 'demo',
            stage: 'quality',
            type: 'stage:complete',
          },
          name: 'video_agent_events',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {events: Array<{event: {stage?: string; type: string}; kind: string}>}

      expect(result.events).to.have.length(1)
      expect(result.events[0]?.event).to.include({
        stage: 'quality',
        type: 'stage:complete',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('calls Deck shard planning and backend export tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'deck-demo')
      await writeDeckArtifacts(root, 'deck-demo')

      const playwrightPath = join(root, 'fake-playwright.ts')
      await writeFile(
        playwrightPath,
        [
          'const manifestPath = Bun.argv.at(-1)',
          'if (manifestPath === undefined) process.exit(2)',
          'const manifest = await Bun.file(manifestPath).json()',
          "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8//8/AwMDCwMYAAAkFAMDuxa40wAAAABJRU5ErkJggg==', 'base64')",
          'for (const frame of manifest.frames) {',
          '  await Bun.write(frame.path, png)',
          '}',
          '',
        ].join('\n'),
      )
      const remotionCommandPath = join(root, 'fake-remotion-render.ts')
      await writeFile(
        remotionCommandPath,
        [
          "await Bun.$`mkdir -p out`",
          "await Bun.write('out/final.mp4', 'fake remotion video')",
          '',
        ].join('\n'),
      )

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const shardResponse = await server.handleMessage({
        id: 'deck-shards-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            frameShardSize: 2,
            projectId: 'deck-demo',
          },
          name: 'video_agent_deck_plan_shards',
        },
      })
      const shardBatchResponse = await server.handleMessage({
        id: 'deck-shard-batch-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            frameCaptureBackend: 'playwright',
            frameShardSize: 2,
            playwrightCommand: ['bun', playwrightPath],
            projectId: 'deck-demo',
            shardConcurrency: 2,
          },
          name: 'video_agent_deck_run_shards',
        },
      })
      const backendResponse = await server.handleMessage({
        id: 'deck-backend-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            backend: 'remotion',
            compositionId: 'DeckMcp',
            projectId: 'deck-demo',
          },
          name: 'video_agent_deck_export_backend',
        },
      })
      const backendRenderResponse = await server.handleMessage({
        id: 'deck-render-backend-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            command: ['bun', remotionCommandPath],
            compositionId: 'DeckMcpRender',
            projectId: 'deck-demo',
          },
          name: 'video_agent_deck_render_backend',
        },
      })
      const shardContent = shardResponse?.result as {content: Array<{text: string; type: string}>}
      const shardBatchContent = shardBatchResponse?.result as {content: Array<{text: string; type: string}>}
      const backendContent = backendResponse?.result as {content: Array<{text: string; type: string}>}
      const backendRenderContent = backendRenderResponse?.result as {content: Array<{text: string; type: string}>}
      const shardPlan = JSON.parse(shardContent.content[0]?.text ?? '{}') as {frameShardSize: number; pendingShards: number; shardCount: number}
      const shardBatch = JSON.parse(shardBatchContent.content[0]?.text ?? '{}') as {failedShards: number; frameCapturedCount: number; renderer: string; shardConcurrency: number; status: string}
      const backend = JSON.parse(backendContent.content[0]?.text ?? '{}') as {backend: string; files: {composition: string; motion: string}; projectId: string}
      const backendRender = JSON.parse(backendRenderContent.content[0]?.text ?? '{}') as {backend: string; outputPath: string; projectId: string; status: string}

      expect(shardPlan.frameShardSize).to.equal(2)
      expect(shardPlan.pendingShards).to.equal(shardPlan.shardCount)
      expect(shardBatch.status).to.equal('completed')
      expect(shardBatch.renderer).to.equal('playwright')
      expect(shardBatch.shardConcurrency).to.equal(2)
      expect(shardBatch.failedShards).to.equal(0)
      expect(shardBatch.frameCapturedCount).to.be.greaterThan(0)
      expect(backend.projectId).to.equal('deck-demo')
      expect(backend.backend).to.equal('remotion')
      expect((await stat(backend.files.composition)).size).to.be.greaterThan(0)
      expect((await readFile(backend.files.composition, 'utf8')).includes('DeckMcp')).to.equal(true)
      expect((await stat(backend.files.motion)).size).to.be.greaterThan(0)
      expect(backendRender.projectId).to.equal('deck-demo')
      expect(backendRender.backend).to.equal('remotion')
      expect(backendRender.status).to.equal('rendered')
      expect((await stat(backendRender.outputPath)).size).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns structured export quality gate errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'export-quality-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            projectId: 'demo',
            requireQuality: true,
          },
          name: 'video_agent_export',
        },
      })
      const data = response?.error?.data as {code?: string; name?: string; projectId?: string; quality?: {ok: boolean; summary: {errors: number; warnings: number}}}

      expect(response?.error?.message).to.include('Project demo did not pass quality checks')
      expect(data).to.deep.include({
        code: 'export_quality_failed',
        name: 'ExportQualityError',
        projectId: 'demo',
      })
      expect(data.quality?.ok).to.equal(false)
      expect(data.quality?.summary.errors).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('passes clean output through the export tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const projectDir = join(root, 'projects', 'demo')
      const outputPath = join(root, 'bundle-export')

      await writeFile(join(projectDir, 'notes.txt'), 'bundle')
      await mkdir(outputPath, {recursive: true})
      await writeFile(join(outputPath, 'stale.txt'), 'old')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'export-clean-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            cleanOutput: true,
            format: 'bundle',
            outputPath,
            projectId: 'demo',
          },
          name: 'video_agent_export',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {cleanOutput: boolean; outputPath: string}

      expect(result.cleanOutput).to.equal(true)
      expect(result.outputPath).to.equal(outputPath)
      expect(await readFile(join(outputPath, 'notes.txt'), 'utf8')).to.equal('bundle')
      expect(await exists(join(outputPath, 'stale.txt'))).to.equal(false)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('calls the worker recovery tool in dry-run mode', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'worker-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            dryRun: true,
            status: 'running',
          },
          name: 'video_agent_worker',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {dryRun: boolean; results: Array<{fromStage?: string; projectId: string; status: string}>}

      expect(result.dryRun).to.equal(true)
      expect(result.results.find((item) => item.projectId === 'demo')).to.include({
        fromStage: 'ingest',
        projectId: 'demo',
        status: 'would-recover',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('passes worker attempt limits through the recovery tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'worker-2',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            dryRun: true,
            maxAttempts: 0,
            status: 'running',
          },
          name: 'video_agent_worker',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {results: Array<{projectId: string; skipReason?: string; status: string}>}

      expect(result.results.find((item) => item.projectId === 'demo')).to.include({
        projectId: 'demo',
        skipReason: 'attempt-limit',
        status: 'skipped',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('passes worker stale running thresholds through the recovery tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'worker-3',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            dryRun: true,
            runningStaleAfterMs: 60_000,
            status: 'running',
          },
          name: 'video_agent_worker',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {results: Array<{projectId: string; skipReason?: string; status: string}>}

      expect(result.results.find((item) => item.projectId === 'demo')).to.include({
        projectId: 'demo',
        skipReason: 'running-active',
        status: 'skipped',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('calls the visual samples tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')
      await writeVisualSamples(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'visual-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            includeContent: true,
            projectId: 'demo',
          },
          name: 'video_agent_visual_samples',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {samples: Array<{contentBase64?: string; exists: boolean; relativePath?: string}>}

      expect(result.samples).to.have.length(1)
      expect(result.samples[0]).to.include({
        contentBase64: Buffer.from('first').toString('base64'),
        exists: true,
        relativePath: 'renders/final-frame-first.jpg',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns structured checkpoint errors from runtime tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createRerunProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'rerun-missing-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            fromStage: 'quality-check',
            projectId: 'demo',
          },
          name: 'video_agent_rerun',
        },
      })

      expect(response?.error?.message).to.include('Cannot resume from quality-check')
      expect(response?.error?.data).to.deep.include({
        code: 'checkpoint_invalid',
        fromStage: 'quality-check',
        name: 'PipelineCheckpointError',
      })
      expect((response?.error?.data as {missingArtifacts?: string[]}).missingArtifacts).to.include('render-output.json')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns structured validation errors from runtime tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createRerunProject(root, 'demo')
      await writeRerunArtifacts(root, 'demo')
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await writeFile(join(artifactsDir, 'output-timeline-map.json'), '{"version":1,"source":"","outputDuration":1,"clips":[]}\n')
      await refreshArtifactManifest(artifactsDir)

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'rerun-invalid-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            fromStage: 'quality-check',
            projectId: 'demo',
          },
          name: 'video_agent_rerun',
        },
      })
      const data = response?.error?.data as {code?: string; fromStage?: string; name?: string; schemaInvalidArtifacts?: string[]}

      expect(response?.error?.message).to.include('schema invalid: output-timeline-map.json')
      expect(data).to.deep.include({
        code: 'checkpoint_invalid',
        fromStage: 'quality-check',
        name: 'PipelineCheckpointError',
      })
      expect(data.schemaInvalidArtifacts).to.deep.equal(['output-timeline-map.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns JSON-RPC errors for unknown tools', async () => {
    const server = createVideoAgentMcpServer()
    const response = await server.handleMessage({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'missing_tool',
      },
    })

    expect(response?.error?.message).to.equal('Unknown MCP tool: missing_tool')
  })
})

async function createProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)

  await mkdir(join(projectDir, 'artifacts'), {recursive: true})
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: '/tmp/input.mp4',
    pipeline: 'film',
    projectId,
    stages: ['ingest', 'quality-check'],
  })
}

async function writeQualityArtifacts(root: string, projectId: string): Promise<void> {
  const artifactsDir = join(root, 'projects', projectId, 'artifacts')

  await writeFile(
    join(artifactsDir, 'quality-report.json'),
    `${JSON.stringify({
      issues: [{code: 'timeline.invalid', message: 'bad timeline', severity: 'error'}],
      summary: {
        errors: 1,
        warnings: 0,
      },
      version: 1,
    })}\n`,
  )
  await writeFile(
    join(artifactsDir, 'render-output.json'),
    `${JSON.stringify({
      renderer: 'ffmpeg',
      version: 1,
    })}\n`,
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)

    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

async function createRerunProject(root: string, projectId: string): Promise<string> {
  const projectDir = join(root, 'projects', projectId)
  const inputPath = join(root, `${projectId}.mp4`)

  await mkdir(join(projectDir, 'artifacts'), {recursive: true})
  await writeFile(inputPath, 'placeholder')
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath,
    pipeline: 'film',
    projectId,
    stages: ['quality-check'],
  })

  return inputPath
}

async function writeRerunArtifacts(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const inputPath = join(root, `${projectId}.mp4`)

  await mkdir(artifactsDir, {recursive: true})
  await Promise.all([
    writeFile(
      join(artifactsDir, 'render-output.json'),
      `${JSON.stringify({
        completedAt: '2026-01-01T00:00:00.000Z',
        outputPath: 'renders/final.mp4',
        renderer: 'ffmpeg',
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'narration.json'),
      `${JSON.stringify({
        language: 'zh-CN',
        segments: [],
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'tts-segments.json'),
      '[]\n',
    ),
    writeFile(
      join(artifactsDir, 'output-timeline-map.json'),
      `${JSON.stringify({
        clips: [],
        outputDuration: 1,
        source: inputPath,
        version: 1,
      })}\n`,
    ),
  ])
  await refreshArtifactManifest(artifactsDir)
}

async function writeDeckArtifacts(root: string, projectId: string): Promise<void> {
  const artifactsDir = join(root, 'projects', projectId, 'artifacts')

  await writeFile(
    join(artifactsDir, 'timed-deck.json'),
    `${JSON.stringify({
      deck: {
        format: 'portrait_1080x1920',
        inputMode: 'script-generated',
        language: 'zh-CN',
        slides: [
          {
            blockIds: [],
            evidence: [],
            motion: 'slide-up',
            points: ['MotionIR', 'MCP backend export'],
            slideId: 'slide-001',
            speakerNote: 'MCP should expose Deck backend export.',
            title: 'Deck backend',
            type: 'hero',
            visual: {assetRefs: [], kind: 'text'},
          },
        ],
        theme: 'elegant-dark',
        title: 'Deck backend',
        version: 1,
      },
      timings: [{end: 1, slideId: 'slide-001', start: 0}],
      version: 1,
    })}\n`,
  )
}

async function writeVisualSamples(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const rendersDir = join(projectDir, 'renders')

  await mkdir(rendersDir, {recursive: true})
  await writeFile(join(rendersDir, 'final-frame-first.jpg'), 'first')
  await writeFile(
    join(artifactsDir, 'render-output.json'),
    `${JSON.stringify({
      renderer: 'ffmpeg',
      version: 1,
      visualQuality: {
        frameSample: {
          ok: true,
          path: join(rendersDir, 'final-frame-first.jpg'),
          size: 5,
          timestamp: 0,
        },
      },
    })}\n`,
  )
}

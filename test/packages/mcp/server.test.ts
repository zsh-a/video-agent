import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {createVideoAgentMcpServer} from '../../../packages/mcp/src/server.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'

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
      'video_agent_visual_samples',
      'video_agent_status',
      'video_agent_run',
      'video_agent_rerun',
      'video_agent_worker',
    ])
  })

  it('describes extended render and audio tool options', () => {
    const server = createVideoAgentMcpServer()
    const toolsByName = new Map(server.tools.map((tool) => [tool.name, tool]))
    const renderProperties = toolsByName.get('video_agent_render')?.inputSchema.properties ?? {}
    const audioProperties = toolsByName.get('video_agent_inspect_audio')?.inputSchema.properties ?? {}
    const workerProperties = toolsByName.get('video_agent_worker')?.inputSchema.properties ?? {}

    expect(Object.keys(renderProperties)).to.include.members(['duckingThreshold', 'hyperframesCommand', 'hyperframesOutput', 'hyperframesRender', 'hyperframesValidate', 'sourceVolume', 'voiceoverVolume'])
    expect(Object.keys(audioProperties)).to.include.members(['duckingAttackMs', 'duckingRatio', 'duckingReleaseMs', 'duckingThreshold', 'sourceVolume', 'voiceoverVolume'])
    expect(Object.keys(workerProperties)).to.include.members(['dryRun', 'limit', 'maxAttempts', 'orderBy', 'runningStaleAfterMs', 'status'])
  })

  it('adds client-facing descriptions to important tool arguments', () => {
    const server = createVideoAgentMcpServer()
    const toolsByName = new Map(server.tools.map((tool) => [tool.name, tool]))
    const renderProperties = toolsByName.get('video_agent_render')?.inputSchema.properties as Record<string, {description?: string}> | undefined
    const workerProperties = toolsByName.get('video_agent_worker')?.inputSchema.properties as Record<string, {description?: string}> | undefined
    const runProperties = toolsByName.get('video_agent_run')?.inputSchema.properties as Record<string, {description?: string}> | undefined

    expect(renderProperties?.projectId.description).to.equal('Project id inside the video-agent workspace.')
    expect(renderProperties?.hyperframesCommand.description).to.include('External HyperFrames command prefix')
    expect(renderProperties?.audio.description).to.include('render without source or voiceover audio')
    expect(workerProperties?.runningStaleAfterMs.description).to.include('Skip running jobs')
    expect(workerProperties?.orderBy.description).to.include('Recovery candidate ordering')
    expect(runProperties?.inputPath.description).to.include('source media file')
    expect(runProperties?.workspaceDir.description).to.include('Workspace directory override')
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
      const result = JSON.parse(content[0]?.text ?? '{}') as {providers: Array<{provider: string; role: string}>}

      expect(result.providers.map((provider) => `${provider.role}:${provider.provider}`)).to.deep.equal(['asr:mock', 'vlm:mock', 'tts:mock'])
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
      const result = JSON.parse(content[0]?.text ?? '{}') as {ok: boolean; results: Array<{provider: string; role: string; status: string}>}

      expect(result.ok).to.equal(true)
      expect(result.results.find((item) => item.role === 'asr')).to.include({
        provider: 'mock',
        role: 'asr',
        status: 'succeeded',
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

  it('calls render with extended HyperFrames options', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')
      await writeRenderableArtifacts(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'render-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            audio: false,
            hyperframesCommand: ['hyperframes'],
            hyperframesRender: false,
            hyperframesValidate: false,
            output: join(root, 'hyperframes-output'),
            projectId: 'demo',
            renderer: 'hyperframes',
            sourceVolume: 0.5,
            subtitles: false,
            voiceoverVolume: 1.1,
          },
          name: 'video_agent_render',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const result = JSON.parse(content[0]?.text ?? '{}') as {outputDir: string; renderer: string}

      expect(result.renderer).to.equal('hyperframes')
      expect(result.outputDir).to.equal(join(root, 'hyperframes-output'))
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
            fromStage: 'quality',
            projectId: 'demo',
          },
          name: 'video_agent_rerun',
        },
      })

      expect(response?.error?.message).to.include('Cannot resume from quality')
      expect(response?.error?.data).to.deep.include({
        code: 'checkpoint_invalid',
        fromStage: 'quality',
        name: 'PipelineCheckpointError',
      })
      expect((response?.error?.data as {missingArtifacts?: string[]}).missingArtifacts).to.include('ingest-report.json')
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

      await writeFile(join(artifactsDir, 'clip-plan.json'), '{"version":1,"duration":1,"source":"","sourceDuration":1,"clips":[]}\n')
      await refreshArtifactManifest(artifactsDir)

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'rerun-invalid-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            fromStage: 'quality',
            projectId: 'demo',
          },
          name: 'video_agent_rerun',
        },
      })
      const data = response?.error?.data as {code?: string; issues?: Array<{path: string[]}>; name?: string}

      expect(response?.error?.message).to.equal('Validation failed.')
      expect(data).to.deep.include({
        code: 'validation_error',
        name: 'ZodError',
      })
      expect(data.issues?.map((issue) => issue.path.join('.'))).to.include('source')
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
    projectId,
    stages: ['ingest', 'quality'],
  })
}

async function createRerunProject(root: string, projectId: string): Promise<string> {
  const projectDir = join(root, 'projects', projectId)
  const inputPath = join(root, `${projectId}.mp4`)

  await mkdir(join(projectDir, 'artifacts'), {recursive: true})
  await writeFile(inputPath, 'placeholder')
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath,
    projectId,
    stages: ['quality'],
  })

  return inputPath
}

async function writeRerunArtifacts(root: string, projectId: string): Promise<void> {
  const artifactsDir = join(root, 'projects', projectId, 'artifacts')
  const inputPath = join(root, `${projectId}.mp4`)

  await Promise.all([
    writeFile(
      join(artifactsDir, 'ingest-report.json'),
      `${JSON.stringify({
        artifacts: {},
        completedAt: '2026-01-01T00:00:00.000Z',
        inputPath,
        stage: 'ingest',
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'media-info.json'),
      `${JSON.stringify({
        duration: 1,
        inputPath,
        probedAt: '2026-01-01T00:00:00.000Z',
        streams: [],
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'scene-analysis.json'),
      `${JSON.stringify([
        {
          description: 'scene',
          evidence: [],
          sceneId: 'scene-1',
        },
      ])}\n`,
    ),
    writeFile(
      join(artifactsDir, 'transcript.json'),
      `${JSON.stringify({
        segments: [],
        text: 'transcript',
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
            start: 0,
            visualStyle: 'documentary',
          },
        ],
        targetPlatform: 'generic',
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'clip-plan.json'),
      `${JSON.stringify({
        clips: [
          {
            duration: 1,
            id: 'clip-1',
            sceneId: 'scene-1',
            source: inputPath,
            sourceRange: [0, 1],
            start: 0,
          },
        ],
        duration: 1,
        source: inputPath,
        sourceDuration: 1,
        version: 1,
      })}\n`,
    ),
    writeFile(
      join(artifactsDir, 'timeline.json'),
      `${JSON.stringify({
        duration: 1,
        fps: 30,
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
    writeFile(
      join(artifactsDir, 'tts-segments.json'),
      `${JSON.stringify([
        {
          duration: 1,
          narrationId: 'narration-1',
          path: 'tts/narration-1.wav',
        },
      ])}\n`,
    ),
  ])
}

async function writeRenderableArtifacts(root: string, projectId: string): Promise<void> {
  const artifactsDir = join(root, 'projects', projectId, 'artifacts')

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

async function writeVisualSamples(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const rendersDir = join(projectDir, 'renders')

  await mkdir(rendersDir, {recursive: true})
  await writeFile(join(rendersDir, 'final-frame-first.jpg'), 'first')
  await writeFile(
    join(artifactsDir, 'render-output.json'),
    `${JSON.stringify({
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

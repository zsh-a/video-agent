import {expect} from '#test/expect'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createApiFetchHandler} from '../../../packages/api/src/server.js'
import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {writeConfig} from '../../../packages/runtime/src/config.js'

describe('api server handler', () => {
  it('serves health, projects, status, events, and artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const health = await readJson<{ok: boolean}>(fetch, '/health')
      const projects = await readJson<{projects: unknown[]}>(fetch, '/projects')
      const providerEnv = await readJson<{providers: Array<{provider: string; role: string}>; summary: {total: number}}>(fetch, '/provider-env')
      const providerEnvTemplate = await readJson<{shellTemplate: string}>(fetch, '/provider-env?shellTemplate=true')
      const providerTest = await readJson<{ok: boolean; results: Array<{provider: string; role: string; status: string}>; summary: {failed: number; succeeded: number; total: number}}>(
        fetch,
        '/provider-test',
        {
          body: JSON.stringify({role: 'asr'}),
          method: 'POST',
        },
      )
      const config = await readJson<{persistence: {jobStore: string}; providers: {asr: string; tts: string; vlm: string}}>(fetch, '/config')
      const status = await readJson<{projectId: string; summary: {providers: {total: number}; quality: {errors: number; issues: number; warnings: number}; render: {rendered: boolean}}}>(fetch, '/projects/demo/status')
      const quality = await readJson<{ok: boolean; projectId: string}>(fetch, '/projects/demo/quality')
      const actions = await readJson<{actions: Array<{category: string; command: string; id: string}>; projectId: string}>(fetch, '/projects/demo/actions?commandPrefix=bun%20run%20dev')
      const events = await readJson<{events: unknown[]}>(fetch, '/projects/demo/events?kind=provider&role=asr')
      const pipelineEvents = await readJson<{events: Array<{event: {stage?: string; type: string}; kind: string}>}>(fetch, '/projects/demo/events?kind=pipeline&stage=ingest&type=stage:start')
      const artifact = await readJson<{content: {version: number}}>(fetch, '/projects/demo/artifacts/media-info.json')

      expect(health.ok).to.equal(true)
      expect(projects.projects).to.have.length(1)
      expect(providerEnv.providers.map((provider) => `${provider.role}:${provider.provider}`)).to.deep.equal(['asr:mock', 'vlm:mock', 'tts:mock'])
      expect(providerEnv.summary.total).to.equal(0)
      expect(providerEnvTemplate.shellTemplate).to.include('# video-agent provider environment template')
      expect(providerTest.ok).to.equal(true)
      expect(providerTest.summary).to.deep.include({
        failed: 0,
        succeeded: 1,
        total: 1,
      })
      expect(providerTest.results.find((result) => result.role === 'asr')).to.include({
        provider: 'mock',
        role: 'asr',
        status: 'succeeded',
      })
      expect(config.providers).to.deep.equal({asr: 'mock', tts: 'mock', vlm: 'mock'})
      expect(config.persistence.jobStore).to.equal('json')
      expect(status.projectId).to.equal('demo')
      expect(status.summary.providers.total).to.equal(1)
      expect(status.summary.quality).to.deep.equal({errors: 0, issues: 0, warnings: 0})
      expect(status.summary.render.rendered).to.equal(false)
      expect(quality.projectId).to.equal('demo')
      expect(quality.ok).to.equal(false)
      expect(actions.projectId).to.equal('demo')
      expect(actions.actions.find((action) => action.id === 'inspect-status')).to.include({
        category: 'inspect',
        command: `bun run dev tui --project demo --action status --workspace ${root}`,
        id: 'inspect-status',
      })
      expect(events.events).to.have.length(1)
      expect(pipelineEvents.events).to.have.length(1)
      expect(pipelineEvents.events[0]?.event).to.include({
        stage: 'ingest',
        type: 'stage:start',
      })
      expect(artifact.content.version).to.equal(1)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns 404 for missing routes', async () => {
    const fetch = createApiFetchHandler({workspaceDir: '/tmp/video-agent-api-missing'})
    const response = await fetch(new Request('http://localhost/missing'))

    expect(response.status).to.equal(404)
  })

  it('passes guided action artifact limits through the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{actions: Array<{id: string}>}>(fetch, '/projects/demo/actions?artifactLimit=0')

      expect(result.actions.map((action) => action.id)).to.include('inspect-status')
      expect(result.actions.map((action) => action.id)).to.not.include('open-artifact')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('can include raw quality details from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      await writeQualityArtifacts(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const report = await readJson<{qualityReport?: {summary: {errors: number}}; renderOutput?: {renderer: string}}>(fetch, '/projects/demo/quality?details=true')

      expect(report.qualityReport?.summary.errors).to.equal(1)
      expect(report.renderOutput?.renderer).to.equal('ffmpeg')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns 503 for unhealthy doctor reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await writeConfig(root, {asr: 'command'})

      const fetch = createApiFetchHandler({workspaceDir: root})
      const response = await fetch(new Request('http://localhost/doctor'))
      const report = (await response.json()) as {checks: Array<{message: string; name: string; status: string}>; ok: boolean; summary: {fail: number}}
      const asrCheck = report.checks.find((check) => check.name === 'provider:asr')

      expect(response.status).to.equal(503)
      expect(report.ok).to.equal(false)
      expect(report.summary.fail).to.equal(1)
      expect(asrCheck).to.include({
        name: 'provider:asr',
        status: 'fail',
      })
      expect(asrCheck?.message).to.include('VIDEO_AGENT_ASR_COMMAND')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('uses explicit provider env values for doctor readiness', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))
    const command = '["bun","examples/provider-adapters/mock-json-provider.ts"]'

    try {
      await writeConfig(root, {asr: 'command'})

      const fetch = createApiFetchHandler({workspaceDir: root})
      const response = await fetch(new Request(`http://localhost/doctor?env=VIDEO_AGENT_ASR_COMMAND=${encodeURIComponent(command)}`))
      const report = (await response.json()) as {checks: Array<{name: string; status: string}>; ok: boolean; summary: {fail: number}}

      expect(response.status).to.equal(200)
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

  it('uses explicit provider env values for environment reports and smoke tests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))
    const command = '["bun","examples/provider-adapters/mock-json-provider.ts"]'

    try {
      await writeConfig(root, {
        asr: 'command',
        tts: 'command',
        vlm: 'command',
      })

      const fetch = createApiFetchHandler({workspaceDir: root})
      const providerEnv = await readJson<{
        providers: Array<{
          requirements: Array<{configured: boolean; env: string}>
          role: string
        }>
        summary: {configured: number; missingRequired: string[]}
      }>(fetch, `/provider-env?env=VIDEO_AGENT_ASR_COMMAND=${encodeURIComponent(command)}&env=VIDEO_AGENT_TTS_COMMAND=${encodeURIComponent(command)}&env=VIDEO_AGENT_VLM_COMMAND=${encodeURIComponent(command)}`)
      const providerTest = await readJson<{
        ok: boolean
        results: Array<{metadata?: {model?: string}; output?: {type: string}; provider: string; role: string; status: string}>
        summary: {failed: number; succeeded: number; total: number}
      }>(
        fetch,
        '/provider-test',
        {
          body: JSON.stringify({
            env: {
              VIDEO_AGENT_ASR_COMMAND: command,
              VIDEO_AGENT_TTS_COMMAND: command,
              VIDEO_AGENT_VLM_COMMAND: command,
            },
            role: 'all',
          }),
          method: 'POST',
        },
      )

      expect(providerEnv.providers.flatMap((provider) => provider.requirements.map((requirement) => `${provider.role}:${requirement.env}:${requirement.configured}`))).to.deep.equal([
        'asr:VIDEO_AGENT_ASR_COMMAND:true',
        'vlm:VIDEO_AGENT_VLM_COMMAND:true',
        'tts:VIDEO_AGENT_TTS_COMMAND:true',
      ])
      expect(providerEnv.summary.configured).to.equal(3)
      expect(providerEnv.summary.missingRequired).to.deep.equal([])
      expect(JSON.stringify(providerEnv)).to.not.include(command)
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

  it('serves the Web Studio shell', async () => {
    const fetch = createApiFetchHandler({workspaceDir: '/tmp/video-agent-api-studio'})
    const response = await fetch(new Request('http://localhost/studio'))
    const html = await response.text()

    expect(response.status).to.equal(200)
    expect(response.headers.get('content-type')).to.equal('text/html; charset=utf-8')
    expect(html).to.include('video-agent studio')
    expect(html).to.include('api("/projects")')
    expect(html).to.include('api("/provider-env")')
    expect(html).to.include('api("/config")')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/status')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/artifacts')
    expect(html).to.include('id="provider-summary"')
    expect(html).to.include('report.summary ??')
    expect(html).to.include('summary.configured + "/" + summary.total')
    expect(html).to.include('id="providers"')
    expect(html).to.include('id="config-summary"')
    expect(html).to.include('id="config"')
    expect(html).to.include('id="workspace-summary"')
    expect(html).to.include('id="artifact-preview"')
    expect(html).to.include('id="visual-samples"')
    expect(html).to.include('id="template-summary"')
    expect(html).to.include('id="template-issues"')
    expect(html).to.include('id="render-quality-summary"')
    expect(html).to.include('id="render-quality-issues"')
    expect(html).to.include('id="artifact-integrity-summary"')
    expect(html).to.include('id="artifact-integrity-issues"')
    expect(html).to.include('schema invalid')
    expect(html).to.include('summary.errors + " errors, " + summary.warnings + " warnings')
    expect(html).to.include('id="render-subtitles"')
    expect(html).to.include('id="render-audio"')
    expect(html).to.include('id="render-audio-ducking"')
    expect(html).to.include('id="render-source-volume"')
    expect(html).to.include('id="render-voiceover-volume"')
    expect(html).to.include('id="export-format"')
    expect(html).to.include('id="export-output"')
    expect(html).to.include('id="export-require-quality"')
    expect(html).to.include('id="export-clean-output"')
    expect(html).to.include('Preview')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/artifacts/" + encodeURIComponent(name)')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/artifacts/render-output.json')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/artifacts/verify')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/visual?includeContent=true')
    expect(html).to.include('renderTemplateQuality(renderOutput.content)')
    expect(html).to.include('renderRenderQuality(renderOutput.content)')
    expect(html).to.include('audio.voiceover.missing')
    expect(html).to.include('id="render-action"')
    expect(html).to.include('id="export-action"')
    expect(html).to.include('id="rerun-stage"')
    expect(html).to.include('id="rerun-action"')
    expect(html).to.include('id="worker-action"')
    expect(html).to.include('id="provider-test-action"')
    expect(html).to.include('id="guided-actions"')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/actions')
    expect(html).to.include('renderGuidedActions(result.actions)')
    expect(html).to.include('copyGuidedAction(action.command)')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/render')
    expect(html).to.include('body: JSON.stringify(readRenderOptions())')
    expect(html).to.include('sourceVolume')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/export')
    expect(html).to.include('body: JSON.stringify(readExportOptions())')
    expect(html).to.include('cleanOutput: byId("export-clean-output").checked')
    expect(html).to.include('outputPath", optionalString("export-output")')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/rerun')
    expect(html).to.include('fromStage: byId("rerun-stage").value || undefined')
    expect(html).to.include('api("/worker"')
    expect(html).to.include('api("/provider-test"')
    expect(html).to.include('formatApiError')
    expect(html).to.include('checkpoint_invalid')
    expect(html).to.include('export_quality_failed')
    expect(html).to.include('missingArtifacts')
    expect(html).to.include('quality.errors + " errors, " + quality.warnings + " warnings"')
  })

  it('rejects non-GET Web Studio requests', async () => {
    const fetch = createApiFetchHandler({workspaceDir: '/tmp/video-agent-api-studio'})
    const response = await fetch(new Request('http://localhost/studio', {method: 'POST'}))

    expect(response.status).to.equal(405)
  })

  it('dry-runs workspace job recovery from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{dryRun: boolean; results: Array<{fromStage?: string; projectId: string; status: string}>}>(
        fetch,
        '/worker',
        {
          body: JSON.stringify({
            dryRun: true,
            status: 'running',
          }),
          method: 'POST',
        },
      )

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

  it('passes worker attempt limits through the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{results: Array<{projectId: string; skipReason?: string; status: string}>}>(
        fetch,
        '/worker',
        {
          body: JSON.stringify({
            dryRun: true,
            maxAttempts: 0,
            status: 'running',
          }),
          method: 'POST',
        },
      )

      expect(result.results.find((item) => item.projectId === 'demo')).to.include({
        projectId: 'demo',
        skipReason: 'attempt-limit',
        status: 'skipped',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('passes worker stale running thresholds through the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{results: Array<{projectId: string; skipReason?: string; status: string}>}>(
        fetch,
        '/worker',
        {
          body: JSON.stringify({
            dryRun: true,
            runningStaleAfterMs: 60_000,
            status: 'running',
          }),
          method: 'POST',
        },
      )

      expect(result.results.find((item) => item.projectId === 'demo')).to.include({
        projectId: 'demo',
        skipReason: 'running-active',
        status: 'skipped',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reruns an existing project from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      await writeRerunArtifacts(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{projectId: string; status: string}>(
        fetch,
        '/projects/demo/rerun',
        {
          body: JSON.stringify({fromStage: 'quality-check'}),
          method: 'POST',
        },
      )

      expect(result.projectId).to.equal('demo')
      expect(result.status).to.equal('completed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns a conflict for incomplete checkpoint reruns from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const response = await fetch(
        new Request('http://localhost/projects/demo/rerun', {
          body: JSON.stringify({fromStage: 'quality-check'}),
          method: 'POST',
        }),
      )
      const result = (await response.json()) as {error: {changedArtifacts: string[]; code: string; fromStage: string; missingArtifacts: string[]; name: string; untrackedArtifacts: string[]}}

      expect(response.status).to.equal(409)
      expect(result.error.code).to.equal('checkpoint_invalid')
      expect(result.error.name).to.equal('PipelineCheckpointError')
      expect(result.error.fromStage).to.equal('quality-check')
      expect(result.error.missingArtifacts).to.include.members(['render-output.json', 'tts-segments.json'])
      expect(result.error.changedArtifacts).to.deep.equal([])
      expect(result.error.untrackedArtifacts).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns validation errors for invalid checkpoint IR artifacts from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      await writeRerunArtifacts(root, 'demo')
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')

      await writeFile(join(artifactsDir, 'output-timeline-map.json'), '{"version":1,"source":"","outputDuration":1,"clips":[]}\n')
      await refreshArtifactManifest(artifactsDir)

      const fetch = createApiFetchHandler({workspaceDir: root})
      const response = await fetch(
        new Request('http://localhost/projects/demo/rerun', {
          body: JSON.stringify({fromStage: 'quality-check'}),
          method: 'POST',
        }),
      )
      const result = (await response.json()) as {error: {code: string; fromStage: string; message: string; name: string; schemaInvalidArtifacts: string[]}}

      expect(response.status).to.equal(409)
      expect(result.error.code).to.equal('checkpoint_invalid')
      expect(result.error.name).to.equal('PipelineCheckpointError')
      expect(result.error.fromStage).to.equal('quality-check')
      expect(result.error.message).to.include('schema invalid: output-timeline-map.json')
      expect(result.error.schemaInvalidArtifacts).to.deep.equal(['output-timeline-map.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('plans Deck frame shards and exports renderer backend projects from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'deck-demo')
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

      const fetch = createApiFetchHandler({workspaceDir: root})
      const shardPlan = await readJson<{frameShardSize: number; pendingShards: number; projectId: string; shardCount: number}>(
        fetch,
        '/projects/deck-demo/deck/shards',
        {
          body: JSON.stringify({frameCaptureBackend: 'playwright', frameShardSize: 2}),
          method: 'POST',
        },
      )
      const shardBatch = await readJson<{failedShards: number; frameCapturedCount: number; frameShardSize: number; projectId: string; renderer: string; shardConcurrency: number; status: string}>(
        fetch,
        '/projects/deck-demo/deck/shard-batch',
        {
          body: JSON.stringify({frameCaptureBackend: 'playwright', frameShardSize: 2, playwrightCommand: ['bun', playwrightPath], shardConcurrency: 2}),
          method: 'POST',
        },
      )
      const backend = await readJson<{backend: string; files: {project: string; scene: string}; fps: number; projectId: string}>(
        fetch,
        '/projects/deck-demo/deck/backend',
        {
          body: JSON.stringify({backend: 'motion-canvas', fps: 24}),
          method: 'POST',
        },
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
      const backendRender = await readJson<{backend: string; command: string[]; outputPath: string; projectId: string; status: string}>(
        fetch,
        '/projects/deck-demo/deck/backend-render',
        {
          body: JSON.stringify({command: ['bun', remotionCommandPath], compositionId: 'DeckApi'}),
          method: 'POST',
        },
      )

      expect(shardPlan.projectId).to.equal('deck-demo')
      expect(shardPlan.frameShardSize).to.equal(2)
      expect(shardPlan.shardCount).to.be.greaterThan(0)
      expect(shardPlan.pendingShards).to.equal(shardPlan.shardCount)
      expect(shardBatch.projectId).to.equal('deck-demo')
      expect(shardBatch.status).to.equal('completed')
      expect(shardBatch.renderer).to.equal('playwright')
      expect(shardBatch.frameShardSize).to.equal(2)
      expect(shardBatch.shardConcurrency).to.equal(2)
      expect(shardBatch.failedShards).to.equal(0)
      expect(shardBatch.frameCapturedCount).to.be.greaterThan(0)
      expect(backend.projectId).to.equal('deck-demo')
      expect(backend.backend).to.equal('motion-canvas')
      expect(backend.fps).to.equal(24)
      expect((await stat(backend.files.project)).size).to.be.greaterThan(0)
      expect((await stat(backend.files.scene)).size).to.be.greaterThan(0)
      expect(backendRender.projectId).to.equal('deck-demo')
      expect(backendRender.status).to.equal('rendered')
      expect(backendRender.backend).to.equal('remotion')
      expect(backendRender.command).to.deep.equal(['bun', remotionCommandPath])
      expect((await stat(backendRender.outputPath)).size).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('verifies project artifacts from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      await refreshArtifactManifest(join(root, 'projects', 'demo', 'artifacts'))

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{checked: number; ok: boolean; summary: {checked: number; errors: number; warnings: number}}>(fetch, '/projects/demo/artifacts/verify')

      expect(result.ok).to.equal(true)
      expect(result.checked).to.be.greaterThan(0)
      expect(result.summary).to.deep.include({
        checked: result.checked,
        errors: 0,
        warnings: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('inspects project audio from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{availableVoiceovers: number; missingVoiceovers: unknown[]; warnings: string[]}>(fetch, '/projects/demo/audio')

      expect(result.availableVoiceovers).to.equal(0)
      expect(result.missingVoiceovers).to.deep.equal([])
      expect(result.warnings).to.deep.equal(['No usable audio inputs were found; render will be silent unless the source video already contains audio copied by ffmpeg.'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reads project visual samples from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      await writeVisualSamples(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{samples: Array<{contentBase64?: string; exists: boolean; relativePath?: string; timestamp: number}>}>(fetch, '/projects/demo/visual?includeContent=true')

      expect(result.samples).to.have.length(1)
      expect(result.samples[0]).to.include({
        contentBase64: Buffer.from('first').toString('base64'),
        exists: true,
        relativePath: 'renders/final-frame-first.jpg',
        timestamp: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('exports a project from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))
    const outputPath = join(root, 'exported.mp4')

    try {
      await createApiProject(root, 'demo')
      await mkdir(join(root, 'projects', 'demo', 'renders'), {recursive: true})
      await writeFile(join(root, 'projects', 'demo', 'renders', 'final.mp4'), 'video')
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'render-output.json'),
        `${JSON.stringify({
          outputPath: 'renders/final.mp4',
          renderer: 'ffmpeg',
          version: 1,
        })}\n`,
      )

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{format: string; outputPath: string}>(
        fetch,
        '/projects/demo/export',
        {
          body: JSON.stringify({outputPath}),
          method: 'POST',
        },
      )

      expect(result.format).to.equal('video')
      expect(result.outputPath).to.equal(outputPath)
      expect(await readFile(outputPath, 'utf8')).to.equal('video')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('passes clean output through the export API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')

      const projectDir = join(root, 'projects', 'demo')
      const outputPath = join(root, 'bundle-export')

      await writeFile(join(projectDir, 'notes.txt'), 'bundle')
      await mkdir(outputPath, {recursive: true})
      await writeFile(join(outputPath, 'stale.txt'), 'old')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const response = await fetch(
        new Request('http://localhost/projects/demo/export', {
          body: JSON.stringify({
            cleanOutput: true,
            format: 'bundle',
            outputPath,
          }),
          method: 'POST',
        }),
      )
      const result = (await response.json()) as {cleanOutput: boolean; outputPath: string}

      expect(response.status).to.equal(200)
      expect(result.cleanOutput).to.equal(true)
      expect(result.outputPath).to.equal(outputPath)
      expect(await readFile(join(outputPath, 'notes.txt'), 'utf8')).to.equal('bundle')
      expect(await exists(join(outputPath, 'stale.txt'))).to.equal(false)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns a conflict when export quality gate fails from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      await mkdir(join(root, 'projects', 'demo', 'renders'), {recursive: true})
      await writeFile(join(root, 'projects', 'demo', 'renders', 'final.mp4'), 'video')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const response = await fetch(
        new Request('http://localhost/projects/demo/export', {
          body: JSON.stringify({
            requireQuality: true,
          }),
          method: 'POST',
        }),
      )
      const result = (await response.json()) as {error: {code: string; name: string; projectId: string; quality: {ok: boolean}}}

      expect(response.status).to.equal(409)
      expect(result.error).to.deep.include({
        code: 'export_quality_failed',
        name: 'ExportQualityError',
        projectId: 'demo',
      })
      expect(result.error.quality.ok).to.equal(false)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

interface TestRequestInit {
  body?: string
  method?: string
}

async function readJson<T>(fetch: (request: Request) => Promise<Response>, path: string, init?: TestRequestInit): Promise<T> {
  const response = await fetch(new Request(`http://localhost${path}`, init))

  expect(response.status).to.equal(200)

  return (await response.json()) as T
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

async function createApiProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const inputPath = join(root, `${projectId}.mp4`)

  await mkdir(artifactsDir, {recursive: true})
  await writeFile(inputPath, 'placeholder')
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath,
    pipeline: 'film',
    projectId,
    stages: ['ingest'],
  })
  await writeFile(
    join(artifactsDir, 'media-info.json'),
    `${JSON.stringify({
      inputPath: '/tmp/input.mp4',
      probedAt: '2026-01-01T00:00:00.000Z',
      streams: [],
      version: 1,
    })}\n`,
  )
  await writeFile(join(artifactsDir, 'pipeline-events.jsonl'), `${JSON.stringify({projectId, stage: 'ingest', time: '2026-01-01T00:00:00.000Z', type: 'stage:start'})}\n`)
  await writeFile(
    join(artifactsDir, 'provider-calls.jsonl'),
    `${JSON.stringify({
      completedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 10,
      input: {},
      operation: 'transcribe',
      output: {},
      provider: 'mock',
      requestId: 'asr_1',
      role: 'asr',
      startedAt: '2026-01-01T00:00:00.990Z',
      status: 'succeeded',
      version: 1,
    })}\n`,
  )
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
        frameSamples: [
          {
            ok: true,
            path: join(rendersDir, 'final-frame-first.jpg'),
            size: 5,
            timestamp: 0,
          },
        ],
      },
    })}\n`,
  )
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
            points: ['MotionIR', 'Backend export'],
            slideId: 'slide-001',
            speakerNote: 'Deck backend export should use timed DeckIR.',
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

/* eslint-disable n/no-unsupported-features/node-builtins */
import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
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
      const providerEnv = await readJson<{providers: Array<{provider: string; role: string}>}>(fetch, '/provider-env')
      const providerTest = await readJson<{ok: boolean; results: Array<{provider: string; role: string; status: string}>}>(
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
      const events = await readJson<{events: unknown[]}>(fetch, '/projects/demo/events?kind=provider&role=asr')
      const artifact = await readJson<{content: {version: number}}>(fetch, '/projects/demo/artifacts/media-info.json')

      expect(health.ok).to.equal(true)
      expect(projects.projects).to.have.length(1)
      expect(providerEnv.providers.map((provider) => `${provider.role}:${provider.provider}`)).to.deep.equal(['asr:mock', 'vlm:mock', 'tts:mock'])
      expect(providerTest.ok).to.equal(true)
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
      expect(events.events).to.have.length(1)
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

  it('returns 503 for unhealthy doctor reports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await writeConfig(root, {asr: 'command'})

      const fetch = createApiFetchHandler({workspaceDir: root})
      const response = await fetch(new Request('http://localhost/doctor'))
      const report = (await response.json()) as {checks: Array<{message: string; name: string; status: string}>; ok: boolean}
      const asrCheck = report.checks.find((check) => check.name === 'provider:asr')

      expect(response.status).to.equal(503)
      expect(report.ok).to.equal(false)
      expect(asrCheck).to.include({
        name: 'provider:asr',
        status: 'fail',
      })
      expect(asrCheck?.message).to.include('VIDEO_AGENT_ASR_COMMAND')
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
    expect(html).to.include('id="render-renderer"')
    expect(html).to.include('id="render-subtitles"')
    expect(html).to.include('id="render-audio"')
    expect(html).to.include('id="render-audio-ducking"')
    expect(html).to.include('id="render-source-volume"')
    expect(html).to.include('id="render-voiceover-volume"')
    expect(html).to.include('id="render-hf-validate"')
    expect(html).to.include('id="render-hf-render"')
    expect(html).to.include('id="render-hf-command"')
    expect(html).to.include('id="render-hf-output"')
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
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/render')
    expect(html).to.include('body: JSON.stringify(readRenderOptions())')
    expect(html).to.include('hyperframesCommand')
    expect(html).to.include('sourceVolume')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/export')
    expect(html).to.include('/projects/" + encodeURIComponent(state.projectId) + "/rerun')
    expect(html).to.include('fromStage: byId("rerun-stage").value || undefined')
    expect(html).to.include('api("/worker"')
    expect(html).to.include('api("/provider-test"')
  })

  it('rejects non-GET Web Studio requests', async () => {
    const fetch = createApiFetchHandler({workspaceDir: '/tmp/video-agent-api-studio'})
    const response = await fetch(new Request('http://localhost/studio', {method: 'POST'}))

    expect(response.status).to.equal(405)
  })

  it('runs a project from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))
    const inputPath = join(root, 'demo.mp4')

    try {
      await createApiProject(root, 'demo')
      await writeRerunArtifacts(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{projectId: string; status: string}>(
        fetch,
        '/projects',
        {
          body: JSON.stringify({
            fromStage: 'quality',
            inputPath,
            projectId: 'demo',
          }),
          method: 'POST',
        },
      )

      expect(result.projectId).to.equal('demo')
      expect(result.status).to.equal('completed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
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
          body: JSON.stringify({fromStage: 'quality'}),
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
          body: JSON.stringify({fromStage: 'quality'}),
          method: 'POST',
        }),
      )
      const result = (await response.json()) as {error: {changedArtifacts: string[]; fromStage: string; missingArtifacts: string[]; untrackedArtifacts: string[]}}

      expect(response.status).to.equal(409)
      expect(result.error.fromStage).to.equal('quality')
      expect(result.error.missingArtifacts).to.include.members(['ingest-report.json', 'tts-segments.json'])
      expect(result.error.changedArtifacts).to.deep.equal([])
      expect(result.error.untrackedArtifacts).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('renders a project from the API', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-api-'))

    try {
      await createApiProject(root, 'demo')
      await writeRerunArtifacts(root, 'demo')

      const fetch = createApiFetchHandler({workspaceDir: root})
      const result = await readJson<{projectId: string; renderer: string}>(
        fetch,
        '/projects/demo/render',
        {
          body: JSON.stringify({renderer: 'hyperframes'}),
          method: 'POST',
        },
      )

      expect(result.projectId).to.equal('demo')
      expect(result.renderer).to.equal('hyperframes')
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
      const result = await readJson<{checked: number; ok: boolean}>(fetch, '/projects/demo/artifacts/verify')

      expect(result.ok).to.equal(true)
      expect(result.checked).to.be.greaterThan(0)
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
      const result = (await response.json()) as {error: {quality: {ok: boolean}}}

      expect(response.status).to.equal(409)
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

async function createApiProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const inputPath = join(root, `${projectId}.mp4`)

  await mkdir(artifactsDir, {recursive: true})
  await writeFile(inputPath, 'placeholder')
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath,
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
      role: 'asr',
      startedAt: '2026-01-01T00:00:00.990Z',
      status: 'succeeded',
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

async function writeRerunArtifacts(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
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
      join(artifactsDir, 'timeline.json'),
      `${JSON.stringify({
        duration: 1,
        fps: 30,
        items: [],
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

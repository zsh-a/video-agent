import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {readProjectStatus} from '../../../packages/runtime/src/project-status.js'

describe('project status', () => {
  it('summarizes pipeline events and provider calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-'))

    try {
      await createProject(root, 'demo')
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'pipeline-events.jsonl'),
        [
          JSON.stringify({projectId: 'demo', stage: 'ingest', time: '2026-01-01T00:00:00.000Z', type: 'stage:start'}),
          JSON.stringify({projectId: 'demo', stage: 'quality', time: '2026-01-01T00:00:01.000Z', type: 'stage:complete'}),
        ].join('\n'),
      )
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'provider-calls.jsonl'),
        [
          JSON.stringify({completedAt: '2026-01-01T00:00:00.100Z', durationMs: 100, input: {}, operation: 'transcribe', output: {}, provider: 'mock', role: 'asr', startedAt: '2026-01-01T00:00:00.000Z', status: 'succeeded', version: 1}),
          JSON.stringify({completedAt: '2026-01-01T00:00:00.200Z', cost: {amount: 0.04, currency: 'USD'}, durationMs: 100, error: {message: 'failed', name: 'Error'}, input: {}, operation: 'analyzeScenes', provider: 'command', role: 'vlm', startedAt: '2026-01-01T00:00:00.100Z', status: 'failed', version: 1}),
        ].join('\n'),
      )
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'quality-report.json'),
        `${JSON.stringify({
          checkedAt: '2026-01-01T00:00:02.000Z',
          issues: [
            {
              code: 'timeline.item.out_of_bounds',
              message: 'bad timeline',
              severity: 'error',
            },
            {
              code: 'tts.segment.missing',
              message: 'missing voiceover',
              severity: 'warning',
            },
          ],
          summary: {
            errors: 1,
            warnings: 1,
          },
          version: 1,
        })}\n`,
      )
      await writeFile(
        join(root, 'projects', 'demo', 'artifacts', 'render-output.json'),
        `${JSON.stringify({
          audioDiagnostics: {
            missingVoiceovers: [
              {
                index: 0,
                reason: 'missing',
              },
            ],
            warnings: ['1 TTS voiceover segment(s) were referenced but unavailable.'],
          },
          audioInputs: 2,
          audioQuality: {
            errors: 0,
            warnings: 1,
          },
          outputPath: '/tmp/final.mp4',
          outputQuality: {
            errors: 0,
            warnings: 1,
          },
          renderer: 'ffmpeg',
          subtitleQuality: {
            errors: 1,
            warnings: 2,
          },
          version: 1,
          visualQuality: {
            errors: 1,
            warnings: 1,
          },
        })}\n`,
      )

      const status = await readProjectStatus('demo', root)

      expect(status.summary.events).to.deep.equal({
        count: 2,
        last: {
          stage: 'quality',
          time: '2026-01-01T00:00:01.000Z',
          type: 'stage:complete',
        },
      })
      expect(status.summary.providers.total).to.equal(2)
      expect(status.summary.providers.failed).to.equal(1)
      expect(status.summary.providers.costs).to.deep.equal({USD: 0.04})
      expect(status.summary.providers.byRole.asr.succeeded).to.equal(1)
      expect(status.summary.providers.byRole.vlm.failed).to.equal(1)
      expect(status.summary.providers.byRole.vlm.costs).to.deep.equal({USD: 0.04})
      expect(status.summary.quality).to.deep.equal({
        errors: 1,
        issues: 2,
        warnings: 1,
      })
      expect(status.summary.render).to.deep.equal({
        audioInputs: 2,
        audioQualityErrors: 0,
        audioQualityWarnings: 1,
        audioWarnings: 1,
        missingVoiceovers: 1,
        output: '/tmp/final.mp4',
        outputErrors: 0,
        outputWarnings: 1,
        rendered: true,
        renderer: 'ffmpeg',
        subtitleErrors: 1,
        subtitleWarnings: 2,
        visualErrors: 1,
        visualWarnings: 1,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns zero summaries when log artifacts are absent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-'))

    try {
      await createProject(root, 'demo')

      const status = await readProjectStatus('demo', root)

      expect(status.summary.events.count).to.equal(0)
      expect(status.summary.providers.total).to.equal(0)
      expect(status.summary.quality).to.deep.equal({
        errors: 0,
        issues: 0,
        warnings: 0,
      })
      expect(status.summary.render).to.deep.equal({
        audioInputs: 0,
        audioQualityErrors: 0,
        audioQualityWarnings: 0,
        audioWarnings: 0,
        missingVoiceovers: 0,
        outputErrors: 0,
        outputWarnings: 0,
        rendered: false,
        subtitleErrors: 0,
        subtitleWarnings: 0,
        visualErrors: 0,
        visualWarnings: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
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

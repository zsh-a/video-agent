import {expect} from '#test/expect'
import {writeText} from '#test/fs'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {readProjectStatus} from '../../../packages/runtime/src/project/status.js'
import {writeConfig} from '../../../packages/runtime/src/shared/config.js'

describe('project status', () => {
  it('summarizes pipeline events and provider calls', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-'))

    try {
      await createProject(root, 'demo')
      await mkdir(join(root, 'projects', 'demo', 'artifacts', 'chunks', '000'), {recursive: true})
      await writeText(join(root, 'projects', 'demo', 'artifacts', 'chunks', '000', 'vlm.json'), '[]\n')
      await writeText(
        join(root, 'projects', 'demo', 'artifacts', 'pipeline-events.jsonl'),
        [
          JSON.stringify({projectId: 'demo', stage: 'ingest', time: '2026-01-01T00:00:00.000Z', type: 'stage:start'}),
          JSON.stringify({projectId: 'demo', stage: 'quality', time: '2026-01-01T00:00:01.000Z', type: 'stage:complete'}),
        ].join('\n'),
      )
      await writeText(
        join(root, 'projects', 'demo', 'artifacts', 'provider-calls.jsonl'),
        [
          JSON.stringify({completedAt: '2026-01-01T00:00:00.100Z', durationMs: 100, input: {}, operation: 'transcribe', output: {}, provider: 'mock', requestId: 'provider-call-1', role: 'asr', startedAt: '2026-01-01T00:00:00.000Z', status: 'succeeded', version: 1}),
          JSON.stringify({completedAt: '2026-01-01T00:00:00.200Z', cost: {amount: 0.04, currency: 'USD'}, durationMs: 100, error: {message: 'failed', name: 'Error'}, input: {}, operation: 'analyzeScenes', provider: 'command', requestId: 'provider-call-2', role: 'vlm', startedAt: '2026-01-01T00:00:00.100Z', status: 'failed', version: 1}),
        ].join('\n'),
      )
      await writeText(
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
      await writeText(
        join(root, 'projects', 'demo', 'artifacts', 'render-output.json'),
        `${JSON.stringify({
          audioDiagnostics: {
            missingVoiceovers: [
              {
                index: 0,
                narrationId: 'narration-1',
                path: 'tts/narration-1.wav',
                reason: 'missing',
              },
            ],
            availableVoiceovers: 0,
            plan: {
              generatedAt: '2026-01-01T00:00:02.000Z',
              segments: [
                {
                  alignment: 'narration-id',
                  duration: 1,
                  index: 0,
                  narrationId: 'narration-1',
                  path: 'tts/narration-1.wav',
                  start: 0,
                  status: 'missing',
                },
              ],
              version: 1,
            },
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
          reviewHtmlPath: 'renders/review/index.html',
          reviewReportPath: 'artifacts/review-report.json',
          subtitleQuality: {
            errors: 1,
            warnings: 2,
          },
          templateQuality: {
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

      expect(status.artifacts).to.include.members(['chunks/000/vlm.json', 'pipeline-events.jsonl', 'provider-calls.jsonl'])
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
        reviewAvailable: true,
        reviewHtml: 'renders/review/index.html',
        reviewReport: 'artifacts/review-report.json',
        subtitleErrors: 1,
        subtitleWarnings: 2,
        templateErrors: 1,
        templateWarnings: 2,
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
        reviewAvailable: false,
        subtitleErrors: 0,
        subtitleWarnings: 0,
        templateErrors: 0,
        templateWarnings: 0,
        visualErrors: 0,
        visualWarnings: 0,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed JSONL logs instead of returning empty status summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-malformed-jsonl-'))

    try {
      await createProject(root, 'demo')
      await writeText(join(root, 'projects', 'demo', 'artifacts', 'pipeline-events.jsonl'), 'not json\n')
      await writeText(join(root, 'projects', 'demo', 'artifacts', 'provider-calls.jsonl'), 'not json\n')

      await readProjectStatus('demo', root)
      throw new Error('Expected malformed JSONL logs to fail.')
    } catch (error) {
      expect(String(error)).to.include('pipeline-events.jsonl')
      expect(String(error)).to.include('not valid JSON')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects schema-invalid render outputs instead of returning empty render summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-'))

    try {
      await createProject(root, 'demo')
      await writeText(
        join(root, 'projects', 'demo', 'artifacts', 'render-output.json'),
        `${JSON.stringify({
          audioInputs: -1,
          outputQuality: {
            errors: 3,
            warnings: 2,
          },
          renderer: 'ffmpeg',
          version: 1,
        })}\n`,
      )

      await readProjectStatus('demo', root)
      throw new Error('Expected schema-invalid render output to fail.')
    } catch (error) {
      expect(String(error)).to.include('audioInputs')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed render outputs instead of returning empty render summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-'))

    try {
      await createProject(root, 'demo')
      await writeText(join(root, 'projects', 'demo', 'artifacts', 'render-output.json'), 'not json\n')

      await readProjectStatus('demo', root)
      throw new Error('Expected malformed render output to fail.')
    } catch (error) {
      expect(String(error)).to.include('render-output.json')
      expect(String(error)).to.include('is not valid JSON')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects schema-invalid summary-only quality reports instead of returning empty quality summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-'))

    try {
      await createProject(root, 'demo')
      await writeText(
        join(root, 'projects', 'demo', 'artifacts', 'quality-report.json'),
        `${JSON.stringify({
          summary: {
            errors: 2,
            warnings: 1,
          },
          version: 1,
        })}\n`,
      )

      await readProjectStatus('demo', root)
      throw new Error('Expected schema-invalid quality report to fail.')
    } catch (error) {
      expect(String(error)).to.include('issues')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects malformed quality reports instead of returning empty quality summaries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-status-'))

    try {
      await createProject(root, 'demo')
      await writeText(join(root, 'projects', 'demo', 'artifacts', 'quality-report.json'), 'not json\n')

      await readProjectStatus('demo', root)
      throw new Error('Expected malformed quality report to fail.')
    } catch (error) {
      expect(String(error)).to.include('quality-report.json')
      expect(String(error)).to.include('is not valid JSON')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)

  await writeConfig(root, {})
  await mkdir(join(projectDir, 'artifacts'), {recursive: true})
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: '/tmp/input.mp4',
    pipeline: 'film',
    projectId,
    stages: ['ingest', 'quality'],
  })
}

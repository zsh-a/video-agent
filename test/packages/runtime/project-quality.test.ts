import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {readProjectQuality, readProjectQualityDetails} from '../../../packages/runtime/src/project-quality.js'

describe('project quality', () => {
  it('summarizes pipeline, render, and artifact quality', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      await createProject(root, 'demo')

      const report = await readProjectQuality('demo', root)

      expect(report.ok).to.equal(false)
      expect(report.summary).to.deep.equal({
        errors: 3,
        warnings: 8,
      })
      expect(report.pipeline.errors).to.equal(1)
      expect(report.render.missingVoiceovers).to.equal(1)
      expect(report.artifacts.ok).to.equal(false)
      expect(report.artifacts.untracked).to.deep.equal(['untracked.json'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('can include raw quality artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-quality-'))

    try {
      await createProject(root, 'demo')

      const report = await readProjectQualityDetails('demo', root)

      expect(report.qualityReport).to.be.an('object')
      expect(report.renderOutput).to.be.an('object')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')

  await mkdir(artifactsDir, {recursive: true})
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: '/tmp/input.mp4',
    projectId,
    stages: ['ingest', 'quality'],
  })
  await writeFile(
    join(artifactsDir, 'quality-report.json'),
    `${JSON.stringify({
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
    join(artifactsDir, 'render-output.json'),
    `${JSON.stringify({
      audioDiagnostics: {
        missingVoiceovers: [{index: 0, reason: 'missing'}],
        warnings: ['audio warning'],
      },
      audioInputs: 1,
      audioQuality: {
        errors: 0,
        warnings: 1,
      },
      outputQuality: {
        errors: 1,
        warnings: 1,
      },
      renderer: 'ffmpeg',
      subtitleQuality: {
        errors: 0,
        warnings: 1,
      },
      version: 1,
      visualQuality: {
        errors: 1,
        warnings: 1,
      },
    })}\n`,
  )
  await refreshArtifactManifest(artifactsDir)
  await writeFile(join(artifactsDir, 'untracked.json'), '{}\n')
}

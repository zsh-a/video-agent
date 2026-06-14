import {expect} from 'chai'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {readProjectVisualSamples} from '../../../packages/runtime/src/project-visual-samples.js'

describe('project visual samples', () => {
  it('reads rendered frame sample metadata and optional content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-visual-samples-'))

    try {
      await createVisualSampleProject(root, 'demo')

      const result = await readProjectVisualSamples('demo', {
        includeContent: true,
        workspaceDir: root,
      })

      expect(result.projectId).to.equal('demo')
      expect(result.samples).to.have.length(2)
      expect(result.samples[0]).to.include({
        contentBase64: Buffer.from('first').toString('base64'),
        exists: true,
        ok: true,
        relativePath: 'renders/final-frame-first.jpg',
        reportSize: 5,
        size: 5,
        timestamp: 0,
      })
      expect(result.samples[1]).to.include({
        exists: false,
        ok: false,
        relativePath: 'renders/missing.jpg',
        timestamp: 1,
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('does not read sample paths outside the project directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-visual-samples-'))

    try {
      const artifactsDir = join(root, 'projects', 'demo', 'artifacts')
      await mkdir(artifactsDir, {recursive: true})
      await writeFile(
        join(artifactsDir, 'render-output.json'),
        `${JSON.stringify({
          visualQuality: {
            frameSample: {
              ok: true,
              path: '/tmp/outside.jpg',
              timestamp: 0,
            },
          },
        })}\n`,
      )

      const result = await readProjectVisualSamples('demo', {workspaceDir: root})

      expect(result.samples).to.have.length(1)
      expect(result.samples[0]?.exists).to.equal(false)
      expect(result.samples[0]?.error).to.contain('outside the project directory')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createVisualSampleProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const artifactsDir = join(projectDir, 'artifacts')
  const rendersDir = join(projectDir, 'renders')

  await mkdir(artifactsDir, {recursive: true})
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
          {
            ok: false,
            path: join(rendersDir, 'missing.jpg'),
            timestamp: 1,
          },
        ],
      },
    })}\n`,
  )
}

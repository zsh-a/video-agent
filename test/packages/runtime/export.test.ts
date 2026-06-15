import {expect} from 'chai'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifact-store.js'
import {exportProject, ExportQualityError} from '../../../packages/runtime/src/export.js'

describe('export project', () => {
  it('exports a rendered video file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      const renderDir = join(root, 'projects', 'demo', 'renders')

      await mkdir(renderDir, {recursive: true})
      await writeFile(join(renderDir, 'final.mp4'), 'video')

      const outputPath = join(root, 'out.mp4')
      const result = await exportProject({
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(result.outputPath).to.equal(outputPath)
      expect(result.cleanOutput).to.equal(false)
      expect(result.requireQuality).to.equal(false)
      expect(await readFile(outputPath, 'utf8')).to.equal('video')
      expect(await fileSize(result.artifactPath)).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('exports a hyperframes directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      const renderDir = join(root, 'projects', 'demo', 'renders', 'hyperframes')

      await mkdir(renderDir, {recursive: true})
      await writeFile(join(renderDir, 'index.html'), '<html></html>')

      const outputPath = join(root, 'out-hyperframes')
      const result = await exportProject({
        format: 'hyperframes',
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(result.outputPath).to.equal(outputPath)
      expect(result.cleanOutput).to.equal(false)
      expect(await readFile(join(outputPath, 'index.html'), 'utf8')).to.equal('<html></html>')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('can clean stale directory output before exporting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      const renderDir = join(root, 'projects', 'demo', 'renders', 'hyperframes')

      await mkdir(renderDir, {recursive: true})
      await writeFile(join(renderDir, 'index.html'), '<html></html>')

      const outputPath = join(root, 'out-hyperframes')

      await mkdir(outputPath, {recursive: true})
      await writeFile(join(outputPath, 'stale.txt'), 'old')

      const result = await exportProject({
        cleanOutput: true,
        format: 'hyperframes',
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(result.cleanOutput).to.equal(true)
      expect(await readFile(join(outputPath, 'index.html'), 'utf8')).to.equal('<html></html>')
      expect(await exists(join(outputPath, 'stale.txt'))).to.equal(false)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('keeps stale directory output when clean output is not requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      const renderDir = join(root, 'projects', 'demo', 'renders', 'hyperframes')

      await mkdir(renderDir, {recursive: true})
      await writeFile(join(renderDir, 'index.html'), '<html></html>')

      const outputPath = join(root, 'out-hyperframes')

      await mkdir(outputPath, {recursive: true})
      await writeFile(join(outputPath, 'stale.txt'), 'old')

      await exportProject({
        format: 'hyperframes',
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(await readFile(join(outputPath, 'stale.txt'), 'utf8')).to.equal('old')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects directory export targets that overlap the source directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      const renderDir = join(root, 'projects', 'demo', 'renders', 'hyperframes')

      await mkdir(renderDir, {recursive: true})
      await writeFile(join(renderDir, 'index.html'), '<html></html>')

      let insideError: unknown
      let containingError: unknown

      try {
        await exportProject({
          format: 'hyperframes',
          outputPath: join(renderDir, 'nested-export'),
          projectId: 'demo',
          workspaceDir: root,
        })
      } catch (error) {
        insideError = error
      }

      try {
        await exportProject({
          format: 'hyperframes',
          outputPath: join(root, 'projects', 'demo', 'renders'),
          projectId: 'demo',
          workspaceDir: root,
        })
      } catch (error) {
        containingError = error
      }

      expect((insideError as Error).message).to.include('cannot be inside export source')
      expect((containingError as Error).message).to.include('cannot contain export source')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('refuses export when quality is required and project is not clean', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      await createRenderedProject(root, 'demo')
      await writeQualityArtifacts(root, 'demo', {errors: 1, warnings: 0})

      let error: unknown

      try {
        await exportProject({
          outputPath: join(root, 'out.mp4'),
          projectId: 'demo',
          requireQuality: true,
          workspaceDir: root,
        })
      } catch (error_) {
        error = error_
      }

      expect(error).to.be.instanceOf(ExportQualityError)
      expect((error as ExportQualityError).quality.ok).to.equal(false)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('exports when quality is required and project is clean', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      await createRenderedProject(root, 'demo')
      await writeQualityArtifacts(root, 'demo', {errors: 0, warnings: 0})

      const outputPath = join(root, 'out.mp4')
      const result = await exportProject({
        outputPath,
        projectId: 'demo',
        requireQuality: true,
        workspaceDir: root,
      })

      expect(result.requireQuality).to.equal(true)
      expect(result.quality?.ok).to.equal(true)
      expect(await readFile(outputPath, 'utf8')).to.equal('video')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
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

async function createRenderedProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)
  const renderDir = join(projectDir, 'renders')

  await mkdir(renderDir, {recursive: true})
  await writeFile(join(renderDir, 'final.mp4'), 'video')
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: '/tmp/input.mp4',
    projectId,
    stages: ['ingest', 'quality'],
  })
}

async function writeQualityArtifacts(root: string, projectId: string, summary: {errors: number; warnings: number}): Promise<void> {
  const artifactsDir = join(root, 'projects', projectId, 'artifacts')

  await mkdir(artifactsDir, {recursive: true})
  await writeFile(
    join(artifactsDir, 'quality-report.json'),
    `${JSON.stringify({
      issues:
        summary.errors > 0
          ? [
              {
                code: 'quality.failed',
                message: 'failed',
                severity: 'error',
              },
            ]
          : [],
      summary,
      version: 1,
    })}\n`,
  )
  await writeFile(
    join(artifactsDir, 'render-output.json'),
    `${JSON.stringify({
      outputQuality: {
        errors: 0,
        warnings: 0,
      },
      renderer: 'ffmpeg',
      subtitleQuality: {
        errors: 0,
        warnings: 0,
      },
      version: 1,
    })}\n`,
  )
  await refreshArtifactManifest(artifactsDir)
}

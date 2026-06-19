import {expect} from '#test/expect'
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {refreshArtifactManifest} from '../../../packages/runtime/src/artifacts/store.js'
import {exportProject, ExportQualityError} from '../../../packages/runtime/src/render/export.js'

describe('export project', () => {
  it('exports a rendered video file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      await createRenderedProject(root, 'demo')

      const outputPath = join(root, 'out.mp4')
      const result = await exportProject({
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(result.format).to.equal('video')
      expect(result.outputPath).to.equal(outputPath)
      expect(result.cleanOutput).to.equal(false)
      expect(result.requireQuality).to.equal(false)
      expect(await readFile(outputPath, 'utf8')).to.equal('video')
      expect(await fileSize(result.artifactPath)).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('exports a project bundle when no rendered output exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      await createBundleProject(root, 'demo')

      const outputPath = join(root, 'out-bundle')
      const result = await exportProject({
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(result.format).to.equal('bundle')
      expect(result.sourcePath).to.equal(join(root, 'projects', 'demo'))
      expect(await readFile(join(outputPath, 'notes.txt'), 'utf8')).to.equal('bundle')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('can clean stale bundle output before exporting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      await createBundleProject(root, 'demo')
      const outputPath = join(root, 'out-bundle')

      await mkdir(outputPath, {recursive: true})
      await writeFile(join(outputPath, 'stale.txt'), 'old')

      const result = await exportProject({
        cleanOutput: true,
        format: 'bundle',
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(result.cleanOutput).to.equal(true)
      expect(await readFile(join(outputPath, 'notes.txt'), 'utf8')).to.equal('bundle')
      expect(await exists(join(outputPath, 'stale.txt'))).to.equal(false)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('keeps stale bundle output when clean output is not requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      await createBundleProject(root, 'demo')
      const outputPath = join(root, 'out-bundle')

      await mkdir(outputPath, {recursive: true})
      await writeFile(join(outputPath, 'stale.txt'), 'old')

      await exportProject({
        format: 'bundle',
        outputPath,
        projectId: 'demo',
        workspaceDir: root,
      })

      expect(await readFile(join(outputPath, 'stale.txt'), 'utf8')).to.equal('old')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects bundle export targets that overlap the source directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-export-'))

    try {
      await createBundleProject(root, 'demo')
      const projectDir = join(root, 'projects', 'demo')

      let insideError: unknown
      let containingError: unknown

      try {
        await exportProject({
          format: 'bundle',
          outputPath: join(projectDir, 'nested-export'),
          projectId: 'demo',
          workspaceDir: root,
        })
      } catch (error) {
        insideError = error
      }

      try {
        await exportProject({
          format: 'bundle',
          outputPath: join(root, 'projects'),
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
  const artifactsDir = join(projectDir, 'artifacts')
  const renderDir = join(projectDir, 'renders')

  await mkdir(artifactsDir, {recursive: true})
  await mkdir(renderDir, {recursive: true})
  await writeFile(join(renderDir, 'final.mp4'), 'video')
  await writeFile(
    join(artifactsDir, 'render-output.json'),
    `${JSON.stringify({
      outputPath: 'renders/final.mp4',
      renderer: 'ffmpeg',
      version: 1,
    })}\n`,
  )
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: '/tmp/input.mp4',
    pipeline: 'film',
    projectId,
    stages: ['render-final', 'quality-check'],
  })
  await refreshArtifactManifest(artifactsDir)
}

async function createBundleProject(root: string, projectId: string): Promise<void> {
  const projectDir = join(root, 'projects', projectId)

  await mkdir(projectDir, {recursive: true})
  await writeFile(join(projectDir, 'notes.txt'), 'bundle')
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
  await refreshArtifactManifest(artifactsDir)
}

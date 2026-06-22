import {expect} from '#test/expect'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {listProjects, readMostRecentProjectId} from '../../../packages/runtime/src/project/projects.js'
import {writeConfig} from '../../../packages/runtime/src/shared/config.js'

describe('projects', () => {
  it('lists project summaries sorted by update time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-projects-'))

    try {
      await createJob(root, 'old', ['ingest'])
      await createJob(root, 'new', ['ingest', 'quality'])

      const projects = await listProjects(root)

      expect(projects.map((project) => project.projectId)).to.deep.equal(['new', 'old'])
      expect(projects[0].status).to.equal('running')
      expect(await readMostRecentProjectId(root)).to.equal('new')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns an empty list when workspace has no projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-projects-'))

    try {
      await writeConfig(root, {})

      expect(await listProjects(root)).to.deep.equal([])
      const error = await captureAsyncError(() => readMostRecentProjectId(root))

      expect(error).to.be.instanceOf(Error)
      expect(error instanceof Error ? error.message : '').to.equal(`No projects found in workspace ${root}.`)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects project directories without job state instead of ignoring legacy entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-projects-'))

    try {
      await mkdir(join(root, 'projects', 'legacy'), {recursive: true})
      await createJob(root, 'demo', ['ingest'])

      const error = await captureAsyncError(() => listProjects(root))

      expect(String(error)).to.include('Job state JSON is missing')
      expect(String(error)).to.include(join(root, 'projects', 'legacy', 'job-state.json'))
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createJob(root: string, projectId: string, stages: string[]): Promise<void> {
  const projectDir = join(root, 'projects', projectId)

  await writeConfig(root, {})
  await mkdir(projectDir, {recursive: true})
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: `/tmp/${projectId}.mp4`,
    pipeline: 'film',
    projectId,
    stages,
  })
}

async function captureAsyncError(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
  } catch (error) {
    return error
  }

  throw new Error('Expected function to throw')
}

import {expect} from 'chai'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {listProjects} from '../../../packages/runtime/src/projects.js'

describe('projects', () => {
  it('lists project summaries sorted by update time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-projects-'))

    try {
      await createJob(root, 'old', ['ingest'])
      await createJob(root, 'new', ['ingest', 'quality'])

      const projects = await listProjects(root)

      expect(projects.map((project) => project.projectId)).to.deep.equal(['new', 'old'])
      expect(projects[0].status).to.equal('running')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns an empty list when workspace has no projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-projects-'))

    try {
      expect(await listProjects(root)).to.deep.equal([])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createJob(root: string, projectId: string, stages: string[]): Promise<void> {
  const projectDir = join(root, 'projects', projectId)

  await mkdir(projectDir, {recursive: true})
  await new JsonJobStore(join(projectDir, 'job-state.json')).initialize({
    inputPath: `/tmp/${projectId}.mp4`,
    projectId,
    stages,
  })
}

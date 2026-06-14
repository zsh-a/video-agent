import {expect} from 'chai'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {JsonJobStore} from '../../../packages/db/src/job-store.js'
import {createVideoAgentMcpServer} from '../../../packages/mcp/src/server.js'

describe('mcp server', () => {
  it('lists video-agent tools', async () => {
    const server = createVideoAgentMcpServer()
    const response = await server.handleMessage({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/list',
    })

    expect(response?.result).to.have.property('tools')
    expect((response?.result as {tools: Array<{name: string}>}).tools.map((tool) => tool.name)).to.include.members([
      'video_agent_list_projects',
      'video_agent_quality',
      'video_agent_status',
      'video_agent_run',
      'video_agent_rerun',
    ])
  })

  it('calls runtime tools and returns text content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-mcp-'))

    try {
      await createProject(root, 'demo')

      const server = createVideoAgentMcpServer({workspaceDir: root})
      const response = await server.handleMessage({
        id: 'status-1',
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          arguments: {
            projectId: 'demo',
          },
          name: 'video_agent_status',
        },
      })
      const {content} = response?.result as {content: Array<{text: string; type: string}>}
      const [firstContent] = content
      const status = JSON.parse(firstContent?.text ?? '{}') as {projectId: string; summary: {quality: {issues: number}}}

      expect(firstContent?.type).to.equal('text')
      expect(status.projectId).to.equal('demo')
      expect(status.summary.quality.issues).to.equal(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('returns JSON-RPC errors for unknown tools', async () => {
    const server = createVideoAgentMcpServer()
    const response = await server.handleMessage({
      id: 1,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'missing_tool',
      },
    })

    expect(response?.error?.message).to.equal('Unknown MCP tool: missing_tool')
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

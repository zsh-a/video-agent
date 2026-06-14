import {expect} from 'chai'

import {createMcpClientConfig} from '../../../packages/mcp/src/config.js'

describe('mcp client config', () => {
  it('creates a Bun development stdio config', () => {
    expect(createMcpClientConfig({workspaceDir: '.video-agent'})).to.deep.equal({
      mcpServers: {
        'video-agent': {
          args: ['run', 'dev', 'mcp', '--workspace', '.video-agent'],
          command: 'bun',
        },
      },
    })
  })

  it('creates an installed CLI stdio config', () => {
    expect(createMcpClientConfig({mode: 'installed', serverName: 'video-agent-local', workspaceDir: '/tmp/workspace'})).to.deep.equal({
      mcpServers: {
        'video-agent-local': {
          args: ['mcp', '--workspace', '/tmp/workspace'],
          command: 'vagent',
        },
      },
    })
  })
})

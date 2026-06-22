import {expect} from '#test/expect'

import {
  createMcpClientConfig,
  createMcpClientConfigOutput,
  getMcpClientConfigPresetInfo,
  listMcpClientConfigPresetInfo,
  supportedMcpClientConfigPresets,
} from '../../../packages/mcp/src/config.js'

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

  it('adds sorted environment variables to a full config', () => {
    expect(createMcpClientConfig({
      env: {
        VIDEO_AGENT_ASR_COMMAND: 'asr-provider',
        VIDEO_AGENT_TTS_COMMAND: 'tts-provider',
      },
      workspaceDir: '.video-agent',
    })).to.deep.equal({
      mcpServers: {
        'video-agent': {
          args: ['run', 'dev', 'mcp', '--workspace', '.video-agent'],
          command: 'bun',
          env: {
            VIDEO_AGENT_ASR_COMMAND: 'asr-provider',
            VIDEO_AGENT_TTS_COMMAND: 'tts-provider',
          },
        },
      },
    })
  })

  it('can output only the server entry for clients that nest it themselves', () => {
    expect(createMcpClientConfigOutput({
      mode: 'installed',
      shape: 'server',
      workspaceDir: '.video-agent',
    })).to.deep.equal({
      args: ['mcp', '--workspace', '.video-agent'],
      command: 'vagent',
    })
  })

  it('uses client presets to select the default config shape', () => {
    expect(createMcpClientConfigOutput({
      client: 'server-entry',
      mode: 'installed',
      workspaceDir: '.video-agent',
    })).to.deep.equal({
      args: ['mcp', '--workspace', '.video-agent'],
      command: 'vagent',
    })

    expect(createMcpClientConfigOutput({
      client: 'claude-desktop',
      serverName: 'video-agent-local',
      workspaceDir: '.video-agent',
    })).to.deep.equal({
      mcpServers: {
        'video-agent-local': {
          args: ['run', 'dev', 'mcp', '--workspace', '.video-agent'],
          command: 'bun',
        },
      },
    })
  })

  it('lets explicit config shape override client presets', () => {
    expect(createMcpClientConfigOutput({
      client: 'server-entry',
      shape: 'full',
      workspaceDir: '.video-agent',
    })).to.deep.equal({
      mcpServers: {
        'video-agent': {
          args: ['run', 'dev', 'mcp', '--workspace', '.video-agent'],
          command: 'bun',
        },
      },
    })
  })

  it('describes client config preset placement', () => {
    expect(getMcpClientConfigPresetInfo('server-entry')).to.deep.equal({
      client: 'server-entry',
      description: 'Server entry only for clients whose UI or config file already supplies the MCP server name.',
      placement: 'Paste the returned command/args/env object inside the host-provided server entry.',
      shape: 'server',
    })

    expect(getMcpClientConfigPresetInfo('cursor')).to.deep.equal({
      client: 'cursor',
      description: 'Full common MCP JSON object for Cursor-style configuration.',
      placement: 'Paste the returned mcpServers object into the client MCP JSON configuration.',
      shape: 'full',
    })
  })

  it('lists supported client config presets for external tool discovery', () => {
    expect(supportedMcpClientConfigPresets).to.deep.equal([
      'generic',
      'claude-desktop',
      'cursor',
      'server-entry',
    ])

    expect(listMcpClientConfigPresetInfo().map((info) => `${info.client}:${info.shape}`)).to.deep.equal([
      'generic:full',
      'claude-desktop:full',
      'cursor:full',
      'server-entry:server',
    ])
  })

})

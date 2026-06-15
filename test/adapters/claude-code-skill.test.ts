import {expect} from '#test/expect'
import {readText} from '#test/fs'
import {resolve} from 'node:path'

describe('Claude Code skill adapter', () => {
  it('documents the video-agent CLI, MCP, and Studio workflows', async () => {
    const skill = await readText(resolve('adapters', 'claude-code-skill', 'video-agent', 'SKILL.md'))

    expect(skill).to.include('name: video-agent')
    expect(skill).to.include('description: Operate the video-agent Bun/TypeScript video workflow')
    expect(skill).to.not.include('TODO')
    expect(skill).to.include('bun run dev provider-test --json --workspace .video-agent')
    expect(skill).to.include('bun run dev run ./input.mp4')
    expect(skill).to.include('bun run dev worker --dry-run')
    expect(skill).to.include('bun run dev mcp --print-config')
    expect(skill).to.include('http://127.0.0.1:4317/studio')
  })
})

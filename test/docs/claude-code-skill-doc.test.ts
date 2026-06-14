import {expect} from 'chai'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

describe('Claude Code skill docs', () => {
  it('documents install and distribution paths for the skill adapter', async () => {
    const doc = await readFile(resolve('docs', 'claude-code-skill.md'), 'utf8')
    const readme = await readFile(resolve('README.md'), 'utf8')

    expect(doc).to.include('adapters/claude-code-skill/video-agent')
    expect(doc).to.include('cp -R adapters/claude-code-skill/video-agent')
    expect(doc).to.include('ln -sfn "$(pwd)/adapters/claude-code-skill/video-agent"')
    expect(doc).to.include('tar -C adapters/claude-code-skill -czf video-agent-skill.tgz video-agent')
    expect(doc).to.include('bun run dev mcp --print-config --workspace .video-agent')
    expect(readme).to.include('[docs/claude-code-skill.md](docs/claude-code-skill.md)')
  })
})

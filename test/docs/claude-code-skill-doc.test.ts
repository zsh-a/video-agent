import {expect} from 'chai'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

describe('Claude Code skill docs', () => {
  it('documents install and distribution paths for the skill adapter', async () => {
    const doc = await readFile(resolve('docs', 'claude-code-skill.md'), 'utf8')
    const checks = await readFile(resolve('docs', 'agent-client-checks.md'), 'utf8')
    const providerRecipes = await readFile(resolve('docs', 'provider-adapter-recipes.md'), 'utf8')
    const readme = await readFile(resolve('README.md'), 'utf8')

    expect(doc).to.include('adapters/claude-code-skill/video-agent')
    expect(doc).to.include('cp -R adapters/claude-code-skill/video-agent')
    expect(doc).to.include('ln -sfn "$(pwd)/adapters/claude-code-skill/video-agent"')
    expect(doc).to.include('tar -C adapters/claude-code-skill -czf video-agent-skill.tgz video-agent')
    expect(doc).to.include('bun run dev mcp --print-config --workspace .video-agent')
    expect(doc).to.include('[Agent Client Checks](agent-client-checks.md)')
    expect(checks).to.include('bun run dev doctor --workspace .video-agent')
    expect(checks).to.include('bun run dev provider-test --json --workspace .video-agent')
    expect(checks).to.include('bun run dev mcp --print-config --config-shape server --server-name video-agent-local --workspace .video-agent')
    expect(checks).to.include('ln -sfn "$(pwd)/adapters/claude-code-skill/video-agent" "$SKILLS_DIR/video-agent"')
    expect(checks).to.include('Do not paste provider token values')
    expect(providerRecipes).to.include('examples/provider-adapters/mock-json-provider.ts')
    expect(providerRecipes).to.include('examples/provider-adapters/mock-http-provider.ts')
    expect(providerRecipes).to.include('VIDEO_AGENT_ASR_COMMAND')
    expect(providerRecipes).to.include('VIDEO_AGENT_ASR_URL')
    expect(providerRecipes).to.include('x-video-agent-request-id')
    expect(readme).to.include('[docs/claude-code-skill.md](docs/claude-code-skill.md)')
    expect(readme).to.include('[docs/agent-client-checks.md](docs/agent-client-checks.md)')
    expect(readme).to.include('[docs/provider-adapter-recipes.md](docs/provider-adapter-recipes.md)')
  })
})

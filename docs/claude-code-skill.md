# Claude Code Skill Adapter

`adapters/claude-code-skill/video-agent` is a self-contained agent skill adapter over the video-agent CLI and MCP server. It does not own workflow behavior; it tells an agent shell how to call `bun run dev` or `vagent` commands in this repository.

## Source Layout

```text
adapters/claude-code-skill/
  video-agent/
    SKILL.md
    agents/openai.yaml
```

Validate the skill shape from the repository root:

```sh
python3 /home/zs/.codex/skills/.system/skill-creator/scripts/quick_validate.py adapters/claude-code-skill/video-agent
```

## Repo-Local Use

Use the skill directly from the repository when the agent shell supports loading skills by path:

```text
adapters/claude-code-skill/video-agent
```

This is the safest development mode because edits are versioned with the project.

## Copy Install

For a Codex-compatible local skills directory, copy the adapter into the skill root:

```sh
SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
mkdir -p "$SKILLS_DIR"
cp -R adapters/claude-code-skill/video-agent "$SKILLS_DIR/video-agent"
```

For Claude Code or another agent shell, use that host's configured skills directory instead:

```sh
SKILLS_DIR="/path/to/agent/skills"
mkdir -p "$SKILLS_DIR"
cp -R adapters/claude-code-skill/video-agent "$SKILLS_DIR/video-agent"
```

## Symlink Install

During local development, prefer a symlink so changes in the repository are visible immediately:

```sh
SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
mkdir -p "$SKILLS_DIR"
ln -sfn "$(pwd)/adapters/claude-code-skill/video-agent" "$SKILLS_DIR/video-agent"
```

## Tarball Distribution

Create a portable archive:

```sh
tar -C adapters/claude-code-skill -czf video-agent-skill.tgz video-agent
```

Install from the archive:

```sh
SKILLS_DIR="${CODEX_HOME:-$HOME/.codex}/skills"
mkdir -p "$SKILLS_DIR"
tar -C "$SKILLS_DIR" -xzf video-agent-skill.tgz
```

## Post-Install Checks

After installing, verify:

```sh
bun run dev doctor --workspace .video-agent
bun run dev mcp --print-config --workspace .video-agent
```

For the full client-neutral verification matrix, including copy/symlink/tarball install checks, MCP config shapes, and secret-handling rules, see [Agent Client Checks](agent-client-checks.md).

If the skill is used outside the repository checkout, install the CLI first or use `vagent` in the commands documented by the skill.

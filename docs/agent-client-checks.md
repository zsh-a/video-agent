# Agent Client Checks

This document records the local checks an agent shell should run after installing the `video-agent` skill or wiring the MCP server into an external client. It is intentionally client-neutral: concrete placement paths differ by host, but the verification commands and expected surfaces are stable.

## Checked Surfaces

| Surface | Purpose | Local check |
| --- | --- | --- |
| Repo-local skill | Use the versioned adapter directly from this checkout | `adapters/claude-code-skill/video-agent/SKILL.md` exists and has no `TODO` |
| Copy install | Install into a host-managed skills directory | `cp -R adapters/claude-code-skill/video-agent "$SKILLS_DIR/video-agent"` |
| Symlink install | Develop the skill without repeated copies | `ln -sfn "$(pwd)/adapters/claude-code-skill/video-agent" "$SKILLS_DIR/video-agent"` |
| Tarball install | Move the adapter across machines or workspaces | `tar -C adapters/claude-code-skill -czf video-agent-skill.tgz video-agent` |
| MCP full config | Clients that accept an `mcpServers` object | `bun run dev mcp --print-config --workspace .video-agent` |
| MCP client preset | Named clients that accept the common full `mcpServers` object | `bun run dev mcp --print-config --client claude-desktop --workspace .video-agent` |
| MCP server entry | Clients that ask for only one server entry | `bun run dev mcp --print-config --config-shape server --server-name video-agent-local --workspace .video-agent` |
| MCP server-entry preset | Clients whose UI already supplies the server name | `bun run dev mcp --print-config --client server-entry --workspace .video-agent` |
| MCP preset info | Confirm whether the preset returns full config or a server entry | `bun run dev mcp --print-config-info --client server-entry --workspace .video-agent` |
| Installed CLI config | Clients that should call the packaged binary | `bun run dev mcp --print-config --config-mode installed --workspace .video-agent` |
| Runtime health | Confirm the client will reach a usable workspace and fail fast on unhealthy checks | `bun run dev doctor --workspace .video-agent` |
| Provider smoke test | Confirm configured ASR/VLM/TTS providers satisfy response contracts | `bun run dev provider-test --json --workspace .video-agent` |
| Web Studio | Confirm HTTP adapter access for visual review | `bun run dev serve --workspace .video-agent --port 4317` then `http://127.0.0.1:4317/studio` |

For HTTP clients, `GET /health` is process liveness and should stay `200` while the server is running. Use `GET /doctor` for readiness; it returns the full doctor JSON report and responds with `503` when provider configuration, workspace access, or media tooling is unhealthy.

## Local Evidence Snapshot

These commands were run from the repository root and should remain valid checks for future releases:

```sh
bun run dev doctor --workspace .video-agent
bun run dev provider-test --json --workspace .video-agent
bun run dev mcp --print-config --workspace .video-agent
bun run dev mcp --print-config --client claude-desktop --workspace .video-agent
bun run dev mcp --print-config --client cursor --workspace .video-agent
bun run dev mcp --print-config --client server-entry --workspace .video-agent
bun run dev mcp --print-config-info --client server-entry --workspace .video-agent
bun run dev mcp --print-config --config-mode installed --workspace .video-agent
bun run dev mcp --print-config --config-shape server --server-name video-agent-local --workspace .video-agent
```

The observed doctor surface reports a writable workspace, readable config, mock ASR/VLM/TTS providers, project count, `ffmpeg`, and `ffprobe`. The observed provider smoke test returns successful ASR/VLM/TTS contract checks for the current provider config. The observed MCP config surfaces produce:

- full `mcpServers.video-agent` config using `bun run dev mcp --workspace .video-agent`
- named full-config presets for clients such as Claude Desktop and Cursor, which use the common `mcpServers` JSON shape
- installed `mcpServers.video-agent` config using `vagent mcp --workspace .video-agent`
- server-only entry output for clients whose UI already names the server
- preset info output describing whether to paste a full `mcpServers` map or a single `command`/`args`/`env` server entry

## Secret Handling

Do not paste provider token values into issue reports, prompts, screenshots, or skill docs. Use these checks instead:

```sh
bun run dev provider-env --json --workspace .video-agent
bun run dev provider-env --shell-template --workspace .video-agent
bun run dev provider-env --env VIDEO_AGENT_ASR_URL=https://example.invalid/asr --json --workspace .video-agent
bun run dev provider-test --json --workspace .video-agent
bun run dev provider-test --env VIDEO_AGENT_ASR_URL=https://example.invalid/asr --role asr --json --workspace .video-agent
bun run dev mcp --print-config --env VIDEO_AGENT_ASR_URL=https://example.invalid/asr --workspace .video-agent
```

`provider-env` reports variable names and configured/missing state only. `provider-env --shell-template`, `GET /provider-env?shellTemplate=true`, and `video_agent_provider_env` with `shellTemplate: true` generate placeholder exports without scraping the current shell environment. `provider-env --env`, `provider-test --env`, and `mcp --print-config --env` use only variables explicitly passed to the command, so a client config can be reviewed without scraping the current shell environment. `provider-test` reports response summaries and provider metadata without printing configured tokens.

## Acceptance Checklist

Before calling an external agent integration ready, verify:

- the skill can be found by the host, either repo-local, copied, symlinked, or unpacked from the tarball
- the skill instructions point to `bun run dev` for checkout workflows and `vagent` for installed workflows
- `doctor` exits successfully for the intended workspace; failed provider or media checks return a non-zero exit code
- HTTP clients treat `GET /doctor` as readiness and fail on `503`, while using `GET /health` only for liveness
- `provider-test` succeeds for the intended workspace or reports provider setup failures clearly
- the generated MCP config shape matches the client field being edited
- any provider credentials are represented only as configured/missing state or explicit env placeholders
- Web Studio opens at the configured API port when visual review is part of the workflow

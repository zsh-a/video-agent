---
name: video-agent
description: Operate the video-agent Bun/TypeScript video workflow from Claude Code or another agent shell. Use when the user asks to inspect media, run or resume the video-agent pipeline, review artifacts/events/quality, render with ffmpeg or HyperFrames, export outputs, recover failed/running jobs, start the API/Web Studio, or configure MCP for this repository.
---

# Video Agent

Use this skill as a thin adapter over the repository CLI and MCP server. Do not edit artifacts directly unless the user explicitly asks; prefer `vagent`/`bun run dev` commands so core/runtime owns workflow behavior.

## Command Prefix

From this repository, use:

```sh
bun run dev <command>
```

If the CLI is installed globally or from the package bin, use:

```sh
vagent <command>
```

Use `--workspace .video-agent` unless the user gives another workspace.

## Basic Workflow

1. Check runtime health:

```sh
bun run dev doctor --workspace .video-agent
```

2. Inspect configured providers without leaking secrets:

```sh
bun run dev provider-env --json --workspace .video-agent
bun run dev provider-test --json --workspace .video-agent
```

3. Inspect an input media file:

```sh
bun run dev inspect ./input.mp4 --workspace .video-agent
```

4. Run the pipeline:

```sh
bun run dev run ./input.mp4 --workspace .video-agent
```

5. Review project state:

```sh
bun run dev projects --workspace .video-agent
bun run dev status <projectId> --workspace .video-agent
bun run dev quality <projectId> --details --json --workspace .video-agent
bun run dev events <projectId> --workspace .video-agent
bun run dev artifacts <projectId> --verify --workspace .video-agent
```

6. Render and export:

```sh
bun run dev render <projectId> --workspace .video-agent
bun run dev render <projectId> --inspect-audio --workspace .video-agent
bun run dev export <projectId> --require-quality --output ./final.mp4 --workspace .video-agent
```

## Resume And Recovery

Resume from a checkpoint only through the CLI:

```sh
bun run dev rerun <projectId> --from-stage script --workspace .video-agent
```

Recover interrupted jobs with a dry run first:

```sh
bun run dev worker --dry-run --order-by oldest --running-stale-after-ms 60000 --workspace .video-agent
bun run dev worker --status failed --limit 1 --workspace .video-agent
```

If recovery reports `checkpoint-invalid`, inspect `missingArtifacts`, `changedArtifacts`, and `untrackedArtifacts` before rerunning. Do not force job state changes around checkpoint validation.

## TUI, API, And Studio

For local review:

```sh
bun run dev tui --workspace .video-agent
bun run dev tui --project <projectId> --action commands --workspace .video-agent
```

For HTTP API and the lightweight Web Studio:

```sh
bun run dev serve --workspace .video-agent --port 4317
```

Then open or point the user to:

```text
http://127.0.0.1:4317/studio
```

The Studio shell uses the same `/projects`, `/status`, `/quality`, `/artifacts`, and `/events` API surface; do not add separate workflow logic there.

## MCP

Start the stdio MCP server:

```sh
bun run dev mcp --workspace .video-agent
```

Print generic client config:

```sh
bun run dev mcp --print-config --workspace .video-agent
bun run dev mcp --print-config --config-mode installed --workspace .video-agent
```

Use MCP tools for agent-to-agent calls when available; use the CLI for shell workflows and reproducible logs.

## Safety Rules

- Keep large media files in the workspace/filesystem; do not put video or audio blobs into prompts.
- Use JSON output flags when automation needs to parse results.
- Do not expose provider token values. Use `provider-env` for env contract checks and `provider-test` for contract smoke tests.
- Do not call ffmpeg directly for supported workflows; use `render`, `inspect`, or runtime-backed commands.
- Run `bun run test` after changing repository code.

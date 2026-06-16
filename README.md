# video-agent

`video-agent` is a Bun-first TypeScript video agent framework. The core stays headless: TypeScript owns orchestration, IR, provider contracts, runtime state, and adapters; media-heavy work stays behind external executors such as `ffmpeg`, `ffprobe`, Chromium, HyperFrames, or the AI SDK-backed LLM boundary.

The repository is runnable today through the root oclif CLI. API, TUI, MCP, Web Studio, and the Claude Code skill are adapters over the same runtime APIs, not separate workflow owners.

## Boundaries

```text
TypeScript:
  pipeline orchestration, IR schemas, provider contracts, runtime state, adapters

External executors:
  ffmpeg, ffprobe, Chromium, HyperFrames CLI, AI SDK-backed hosted models, local command adapters

Not in scope:
  TypeScript video codecs, muxing, audio mixing engines, ASR/VLM/TTS inference kernels
```

## Packages

```text
src/commands/              root oclif CLI adapter

packages/ir/               Zod schemas and shared IR types
packages/core/             stage and pipeline orchestration contracts
packages/runtime/          workspace, artifacts, jobs, config, events, workflow APIs
packages/media/            ffmpeg / ffprobe / subprocess wrappers
packages/providers/        ASR, VLM, TTS, storyboard, and script provider contracts
packages/llm/              internal LLMClient and AI SDK-backed adapter
packages/renderer-ffmpeg/  ffmpeg renderer boundary
packages/renderer-hyperframes/ HyperFrames project/compiler boundary
packages/quality/          pipeline, render, and artifact quality checks
packages/db/               JSON and Bun SQLite job stores
packages/api/              dependency-light Fetch API adapter
packages/mcp/              stdio MCP adapter

adapters/claude-code-skill/ Claude Code skill adapter over CLI/MCP
```

See [docs/architecture.md](./docs/architecture.md) for package responsibilities and architectural rules.

## Setup

Requirements:

- Bun
- `ffmpeg` and `ffprobe` on `PATH`

```sh
bun install
bun run build
bun run test
```

`bun run test` runs the full test suite and `posttest` lint.

## Quickstart

Initialize and check a workspace:

```sh
bun run dev init
bun run dev doctor
bun run dev config --json
```

Run a local media file through the pipeline:

```sh
bun run dev inspect ./input.mp4
bun run dev run ./input.mp4
bun run dev projects
bun run dev status <projectId>
bun run dev render <projectId>
bun run dev export <projectId> --output ./final.mp4
```

Long-video work is chunk-first at the artifact boundary. The shared IR and core contracts include a long-video chunk plan with defaults of 5 minute chunks, 10 second overlap, 1 fps preview sampling, 0.2 fps VLM sampling, scene detection enabled, ASR chunking enabled, and VLM batches of 16 frames. Runtime ingest writes `chunk-plan.json`; understanding uses chunk analysis ranges for ASR/VLM context and writes top-level `scene-batches.json`, `chunk-summaries.json`, `chapters.json`, `global-outline.json`, and `selected-moments.json` plus per-chunk `summary.json`, `silence.json`, `transcript.json`, and `vlm.json` under `chunks/NNN`. Planning and scripting consume the selected moments and chunk context before producing `clip-plan.json`, `narration.json`, and `timeline.json`.

Inspect artifacts and quality:

```sh
bun run dev artifacts <projectId>
bun run dev artifacts <projectId> media-info.json
bun run dev artifacts <projectId> --verify
bun run dev events <projectId>
bun run dev quality <projectId>
bun run dev visual <projectId>
```

Use adapter surfaces:

```sh
bun run dev tui
bun run dev serve --workspace .video-agent --port 4317
bun run dev mcp --workspace .video-agent
bun run dev mcp --print-config
```

## Provider Configuration

Default ASR/VLM/TTS providers are `mock`. For a hosted profile, keep the workspace config small:

```sh
bun run dev config --provider-profile mimo
```

That writes:

```json
{
  "providerProfile": "mimo",
  "version": 1
}
```

At runtime the profile resolves ASR/VLM, storyboard, and script generation through the shared Mimo LLM config. MiMo model IDs are centralized in `packages/providers/src/profiles.ts`; TTS uses the configured MiMo TTS model to write real wav files under each project before render. The token stays outside persisted config and can live in `.env`:

```dotenv
VIDEO_AGENT_LLM_TOKEN=<token>
# Also accepted for the whole MiMo profile:
MIMO_API_KEY=<token>
```

For local adapters:

```sh
bun run dev config --asr command --vlm command --tts command
export VIDEO_AGENT_ASR_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
export VIDEO_AGENT_VLM_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
export VIDEO_AGENT_TTS_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
bun run dev provider-env --json
bun run dev provider-test --json
```

The provider configuration source of truth is [docs/provider-configuration-model.md](./docs/provider-configuration-model.md). Adapter recipes are in [docs/provider-adapter-recipes.md](./docs/provider-adapter-recipes.md).

The runtime reads `.env` from the repository root and from the workspace directory, for example `.video-agent/.env`. Real shell environment variables take precedence over `.env`; explicit `--env KEY=VALUE` flags intentionally bypass `.env` for isolated client checks.

## Runtime Configuration

Job state defaults to project-local JSON. SQLite can be enabled for workspace-level local worker/API state:

```sh
bun run dev config --job-store sqlite
```

Pipeline stages do not retry by default:

```sh
bun run dev config --max-stage-retries 2 --retry-backoff-ms 500
```

## Documentation Map

- [Architecture](./docs/architecture.md): package boundaries, runtime strategy, provider strategy.
- [Provider Configuration Model](./docs/provider-configuration-model.md): persisted config, profiles, env contract, adding providers.
- [Provider Adapter Recipes](./docs/provider-adapter-recipes.md): command JSON adapter examples.
- [Agent Client Checks](./docs/agent-client-checks.md): MCP/skill/client validation and secret-handling checks.
- [Claude Code Skill](./docs/claude-code-skill.md): skill adapter installation and use.
- [Historical Implementation Plan](./docs/implementation-plan.md): archived phase plan and context.

## Current Status

The current runnable slice supports:

- Bun workspace build/test/lint.
- Headless runtime with durable workspace artifacts, job state, events, provider call logs, and checkpoint validation.
- Long-video IR and core chunk planning contracts for chunk-first, evidence-backed, resumable processing.
- Mock, command, LLM, and Mimo-profile provider configuration.
- LLM-backed ASR/VLM/TTS/storyboard/script provider path through the internal AI SDK-backed `LLMClient`.
- ffmpeg and HyperFrames render boundaries, render diagnostics, quality aggregation, export, and quality-gated export.
- CLI, TUI, Fetch API, MCP, and Claude Code skill adapters over the same runtime APIs.

Near-term work:

1. Keep hosted LLM-like services on the shared AI SDK path; add named adapters only for non-LLM or local execution boundaries.
2. Record a real external MCP client validation matrix.
3. Decide whether richer TUI interactions justify adding Ink/Clack runtime dependencies.

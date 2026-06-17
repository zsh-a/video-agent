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
packages/pipeline-deck/    Deck Explainer business pipeline boundary over runtime APIs
packages/pipeline-film/    Film Recap business pipeline boundary over runtime APIs
packages/llm/              internal LLMClient and AI SDK-backed adapter
packages/renderer-ffmpeg/  ffmpeg renderer boundary
packages/renderer-html/    DeckIR to template/theme/motion HTML runtime boundary
packages/renderer-hyperframes/ HyperFrames project/compiler boundary
packages/quality/          pipeline, render, and artifact quality checks
packages/db/               JSON and Bun SQLite job stores
packages/api/              dependency-light Fetch API adapter
packages/mcp/              stdio MCP adapter

adapters/claude-code-skill/ Claude Code skill adapter over CLI/MCP
```

See [docs/architecture.md](./docs/architecture.md) for package responsibilities and architectural rules.

## Pipeline Model

`video-agent` has two business pipelines over one shared runtime:

```text
Film Recap Pipeline
  Video-first, evidence-first, cut-first.
  Used for TV/movie/long-video commentary where source clips are the main visual.

Deck Explainer Pipeline
  Content-first, deck-first, voice-driven.
  Used for text, article, podcast, course, and audio material rendered as PPT-style video.
```

The shared runtime owns jobs, events, checkpoints, artifacts, providers, media wrappers, renderers, and quality checks. Pipeline-specific IR lives in `packages/ir`.

## Setup

Requirements:

- Bun
- `ffmpeg`, `ffprobe`, and Chromium on `PATH`

```sh
bun install
bun run build
bun run test
```

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
bun run dev run ./input.mp4 --progress
bun run dev status <projectId>
bun run dev render <projectId>
bun run dev export <projectId> --output ./output
```

`run --progress` enables an Ink-rendered live progress view for interactive terminals. `--json`, CI, and non-TTY output keep the machine-readable or line-oriented behavior.

Create a PPT-style explainer from text or Markdown:

```sh
bun run dev deck ./notes.md --duration 3m --format portrait --style elegant-dark --project-id notes-demo
bun run dev deck synthesize-voice notes-demo
bun run dev deck render notes-demo
```

Run Film Recap from video to final render:

```sh
bun run dev film ./episode.mp4 --project-id episode-demo --target 10m
```

Or use staged subcommands for checkpoints and reruns:

```sh
bun run dev film ingest ./episode.mp4 --project-id episode-demo
bun run dev film understand episode-demo
bun run dev film build-story-index episode-demo
bun run dev film plan-clips episode-demo --target 10m
bun run dev film cut episode-demo
bun run dev film narrate episode-demo
bun run dev film synthesize-voice episode-demo
bun run dev film mix-audio episode-demo
bun run dev film subtitle episode-demo
bun run dev film render episode-demo
bun run dev quality-check episode-demo
```

See [docs/architecture.md](./docs/architecture.md#film-recap-pipeline) for Film Recap stage details and [docs/architecture.md](./docs/architecture.md#deck-explainer-pipeline) for Deck Explainer stage details.

## Provider Configuration

Default ASR/VLM/TTS providers are `mock`. For a hosted profile:

```sh
bun run dev config --provider-profile mimo
```

Credentials live in `.env` (repository root or workspace directory):

```dotenv
VIDEO_AGENT_LLM_TOKEN=<token>
MIMO_API_KEY=<token>
```

For local command adapters:

```sh
bun run dev config --asr command --vlm command --tts command
export VIDEO_AGENT_ASR_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
export VIDEO_AGENT_VLM_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
export VIDEO_AGENT_TTS_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
bun run dev provider-test --json
```

See [docs/provider-configuration-model.md](./docs/provider-configuration-model.md) for config details and [docs/provider-adapter-recipes.md](./docs/provider-adapter-recipes.md) for adapter examples.

## Runtime Configuration

```sh
# SQLite job store (default: JSON)
bun run dev config --job-store sqlite

# Pipeline stage retries
bun run dev config --max-stage-retries 2 --retry-backoff-ms 500
```

## Adapter Surfaces

```sh
bun run dev tui
bun run dev serve --workspace .video-agent --port 4317
bun run dev mcp --workspace .video-agent
bun run dev mcp --print-config
```

## Documentation

- [Architecture](./docs/architecture.md) — package boundaries, pipeline stages, provider strategy.
- [Provider Configuration Model](./docs/provider-configuration-model.md) — persisted config, profiles, env contract.
- [Provider Adapter Recipes](./docs/provider-adapter-recipes.md) — command JSON adapter examples.
- [Agent Client Checks](./docs/agent-client-checks.md) — MCP/skill/client validation and secret-handling checks.
- [Claude Code Skill](./docs/claude-code-skill.md) — skill adapter installation and use.

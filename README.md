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
packages/runtime/          workspace, artifacts, jobs, config, events, checkpoint/runtime APIs
packages/media/            ffmpeg / ffprobe / subprocess wrappers
packages/providers/        ASR, VLM, TTS, storyboard, and script provider contracts
packages/pipeline-deck/    Deck Explainer business pipeline boundary over runtime APIs
packages/pipeline-film/    Film Recap business pipeline boundary over runtime APIs
packages/llm/              internal LLMClient and AI SDK-backed adapter
packages/renderer-ffmpeg/  ffmpeg renderer boundary
packages/renderer-deck/    shared DeckIR React/Tailwind templates, themes, Shiki code highlighting, and MotionIR compiler
packages/renderer-html/    browser HTML/Playwright capture boundary over shared deck templates
packages/renderer-hyperframes/ HyperFrames project/compiler boundary
packages/renderer-motion-canvas/ Motion Canvas project compiler boundary for technical diagram scenes
packages/renderer-remotion/ Remotion project compiler boundary for DeckIR + MotionIR
packages/quality/          pipeline, render, and artifact quality checks
packages/db/               JSON and Bun SQLite job stores
packages/api/              dependency-light Fetch API adapter
packages/studio/           React/Tailwind Web Studio frontend served by the API adapter
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

The shared runtime owns jobs, events, checkpoints, artifacts, workspace IO, and provider setup helpers. Pipeline packages own business workflow behavior, provider calls, renderer orchestration, and quality gates. Pipeline-specific IR lives in `packages/ir`.

Deck text planning uses staged LLM calls: content analysis, slide plan, then script and semantic metadata. Long text and large transcript batches are chunked for content analysis and merged before slide planning, so the runtime avoids silent truncation while keeping template validation and no-runtime-repair behavior.

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

Inspect media, run a business pipeline, and inspect/export project output:

```sh
bun run dev inspect ./input.mp4
bun run dev film ./episode.mp4 --project-id episode-demo --target 10m
bun run dev deck ./notes.md --source-type markdown --duration 3m --project-id notes-demo
bun run dev status <projectId>
bun run dev provider-report <projectId>
bun run dev render <projectId>
bun run dev export <projectId> --output ./output
```

`film` and `deck` own workflow behavior. The root `render` command is an ffmpeg timeline renderer for projects that have `timeline.json`; Deck final rendering should use `deck render`, and Film final rendering should use `film render` or the full `film` pipeline. `export` copies the latest rendered video when `render-output.json` is present, or a project bundle when no rendered output exists. `--json`, CI, and non-TTY output keep the machine-readable or line-oriented behavior.

Use `provider-report <projectId>` to audit real provider calls and LLM traces after a run. It summarizes calls by role, provider, and model, plus traced LLM operations by provider/model, including failures, latency, usage, and cost from `artifacts/provider-calls.jsonl` and `artifacts/llm-traces.jsonl`; the same report is available from `GET /projects/:projectId/provider-report` and the `video_agent_provider_report` MCP tool.

Deck final rendering defaults to Remotion. `@video-agent/pipeline-deck` compiles DeckIR plus MotionIR into a Remotion composition, renders a silent H.264 video with JPEG intermediate frames, then uses ffmpeg to mux voiceover audio and `mov_text` subtitles into `renders/final.mp4`. The Deck HTML renderer remains available through `deck render PROJECT --renderer html` for compatibility and inspection workflows. The HTML path uses the template manifest, React server rendering, Tailwind CSS, CSS variables, and a seekable runtime for deterministic browser frame capture; it defaults to Playwright and can use Chromium through `--frame-capture-backend chromium` / `--keyframe-capture-backend chromium`. HTML frame capture still supports bounded concurrency, frame shards, shard batch retry, and `--finalize-only`, but it is no longer the default full-video path. Renderer templates are layered as layout primitives, visual components, slide templates, themes, and motion presets rather than free-form HTML pages.

Optional renderer backend projects can be exported from the same Deck artifacts without making Remotion or Motion Canvas part of the default runtime renderer:

```sh
bun run dev deck export-backend notes-demo --backend remotion
bun run dev deck export-backend notes-demo --backend motion-canvas --fps 24
bun run dev deck render-backend notes-demo --backend remotion --remotion-command '["bun","run","render"]'
```

Export commands write a backend project under `renders/remotion/` or `renders/motion-canvas/` by default and record `deck-renderer-remotion.json` or `deck-renderer-motion-canvas.json` for artifact auditing. `deck render-backend` runs an explicit external Remotion command inside the generated Remotion project, expects `renders/remotion/out/final.mp4` by default, and records `deck-renderer-remotion-output.json`.

Create a PPT-style explainer from text or Markdown:

```sh
bun run dev deck ./notes.md --source-type markdown --duration 3m --format portrait --style elegant-dark --project-id notes-demo
bun run dev deck synthesize-voice notes-demo
bun run dev deck render notes-demo
```

Run Film Recap from a video with an audio track to final render:

```sh
bun run dev film ./episode.mp4 --project-id episode-demo --target 10m
```

Or use staged subcommands for checkpoints and reruns:

```sh
bun run dev film ingest ./episode.mp4 --project-id episode-demo
bun run dev film understand episode-demo
bun run dev film build-story-index episode-demo
bun run dev film write-script episode-demo --target 10m
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

`provider-test` is the provider certification entry point before a real run. It exercises the configured ASR/VLM/TTS contracts and reports failure details, retryability, usage metadata, cost metadata when supplied by the provider, and LLM trace summaries for AI SDK-backed calls.

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

In an interactive terminal, `tui` opens the Ink manager for project navigation, artifact inspection, events, guided commands, and confirmed management actions. Use `--no-interactive`, `--json`, `--watch`, or a non-TTY shell for the script-friendly dashboard/action output.

`serve` exposes Web Studio at `/studio` as a React/Tailwind review desk for project status, artifacts, rendered video output, keyframes, quality issues, provider calls, and LLM traces. Studio starts read-only; rerun, render, and export require enabling project operations in the page. The Studio frontend lives in `packages/studio`; `packages/api` only serves its static build and JSON runtime routes.

## Documentation

- [Architecture](./docs/architecture.md) — package boundaries, pipeline stages, provider strategy.
- [Provider Configuration Model](./docs/provider-configuration-model.md) — persisted config, profiles, env contract.
- [Provider Adapter Recipes](./docs/provider-adapter-recipes.md) — command JSON adapter examples.
- [Agent Client Checks](./docs/agent-client-checks.md) — MCP/skill/client validation and secret-handling checks.
- [Claude Code Skill](./docs/claude-code-skill.md) — skill adapter installation and use.

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
packages/renderer-html/    DeckIR to static HTML slide project boundary
packages/renderer-hyperframes/ HyperFrames project/compiler boundary
packages/quality/          pipeline, render, and artifact quality checks
packages/db/               JSON and Bun SQLite job stores
packages/api/              dependency-light Fetch API adapter
packages/mcp/              stdio MCP adapter

adapters/claude-code-skill/ Claude Code skill adapter over CLI/MCP
```

See [docs/architecture.md](./docs/architecture.md) for package responsibilities and architectural rules.

## Pipeline Model

`video-agent` is moving toward two business pipelines over one shared runtime:

```text
Film Recap Pipeline
  Video-first, evidence-first, cut-first.
  Used for TV/movie/long-video commentary where source clips are the main visual.

Deck Explainer Pipeline
  Content-first, deck-first, voice-driven.
  Used for text, article, podcast, course, and audio material rendered as PPT-style video.
```

The shared runtime owns jobs, events, checkpoints, artifacts, providers, media wrappers, renderers, and quality checks. Pipeline-specific contracts live in `packages/ir`: film recap uses `StoryIndex`, `NarrativeBeat`, `OutputTimelineMap`, and output-timeline narration; deck explainer uses `Document`, `ContentBlock`, `Outline`, `Deck`, `Slide`, `SpeakerScript`, and `TimedDeck`.

The current runnable Deck slice is available through `deck`. The current Film slice runs ingest/probe, provider-backed source understanding with ASR/VLM fallbacks, story-index construction, clip planning, cut-first rendering, output-timeline narration, TTS voiceover, source-aware audio mix with ducking when original audio is present, subtitles, final ffmpeg render, and quality report generation.

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
bun run dev export <projectId> --output ./output
```

Create a PPT-style explainer directly from text or Markdown:

```sh
bun run dev deck ./notes.md --duration 3m --format portrait --style tech --project-id notes-demo
bun run dev deck synthesize-voice notes-demo
bun run dev deck render notes-demo
bun run dev deck ./podcast.wav --mode summarize --duration 5m --project-id podcast-summary
bun run dev deck synthesize-voice podcast-summary
bun run dev deck render podcast-summary
bun run dev deck ./podcast.wav --mode audio-anchored --project-id podcast-demo
bun run dev deck render podcast-demo
bun run dev deck render notes-demo --html-render-command '["hyperframes"]' --html-render --html-validate
bun run dev export notes-demo --output ./notes-slides
```

The top-level `deck` command runs the Deck Explainer business pipeline through final render. Text inputs do not call ASR or VLM providers; they split the input into multiple `slide_explainer` pages, write standard render artifacts plus DeckIR artifacts such as `document.json`, `content-blocks.json`, `claims.json`, `source-quotes.json`, `outline.json`, `deck.json`, `speaker-script.json`, and `timed-deck.json`, synthesize a new narration track, update timing to real TTS durations, compile HTML under `renders/html/`, and mux `renders/final.mp4`. `deck --mode summarize` transcribes audio inputs to `transcript.json`, treats the transcript as content, writes `DeckIR` with `inputMode: "script-generated"`, then creates new TTS narration and final video. `deck --mode audio-anchored` transcribes audio, writes `transcript.json`, preserves the source audio as `audio/deck_voiceover.wav`, aligns slides to ASR timestamps or fixed windows, and renders the final video without new TTS. `deck render` also writes `deck-quality-report.json` with slide density, title length, bullet count, timing, duplicate-slide, and chart-source checks; these issues are included in the project quality aggregate. The staged `deck synthesize-voice` and `deck render` commands remain available for reruns or custom HTML capture; pass `--html-render --html-render-command '["hyperframes"]'` to `deck render` to hand `renders/html/` to an external HTML renderer and record the captured output in `render-output.json`. Export defaults to the muxed video.

Run Film Recap from video to final render, or use staged subcommands for checkpoints and reruns:

```sh
bun run dev film ./episode.mp4 --project-id episode-demo --target 10m
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
bun run dev film quality-check episode-demo
```

Film ingest probes the source, computes a source hash, writes `media-info.json` and `source-manifest.json`, and initializes the Film Recap stage list. Source understanding writes `scenes.json`, `frames.json`, `asr-result.json`, `silence-periods.json`, `vlm-analysis.json`, and `timeline-fusion.json`; when the source has audio it extracts `audio/source_audio.wav`, calls the configured ASR provider, derives silence gaps from timestamped ASR, samples scene frames, and calls the configured VLM provider for scene evidence. No-audio or untimed inputs fall back to coarse scene/silence artifacts. Story indexing writes `story-index.json`, `narrative-beats.json`, and `character-index.json`, inferring beat types and character evidence from ASR/VLM facts when available. Clip planning writes `clip-plan.json` with beat-backed source ranges, `priorityScore`, `selectionRank`, and rationale text; it selects high-value evidence-backed beats first, then orders selected clips by source chronology for the cut. Cut rendering writes `renders/edited_source.mp4`, `clip-plan-validated.json`, and `output-timeline-map.json`; when the source has audio, the cut keeps the aligned source audio. Output narration writes Film-specific `output-narration.json` plus compatible `narration.json`. Voice synthesis writes provider-backed `tts-segments.json` and audio files under `audio/tts/`. Audio mixing writes `audio/audio_mix.wav` and `audio-mix.json`; it emits `source-ducked` when original cut audio and TTS are both present, `source-only` for original audio without TTS, `voiceover-only` for silent sources with TTS, and `silence` as the fallback. Subtitle and final render write `subtitles.json`, `renders/subtitles.srt`, `renders/final.mp4`, and `render-output.json`; quality check writes `quality-report.json`.

Long-video work is chunk-first at the artifact boundary. The shared IR and core contracts include a long-video chunk plan with defaults of 5 minute chunks, 10 second overlap, 1 fps preview sampling, 0.2 fps VLM sampling, scene detection enabled, ASR chunking enabled, and VLM batches of 16 frames. Runtime ingest writes `chunk-plan.json` and `frames.json`; understanding uses chunk analysis ranges for ASR/VLM context and writes top-level `scene-batches.json`, `chunk-summaries.json`, `chapters.json`, `global-outline.json`, and `selected-moments.json` plus per-chunk `summary.json`, `silence.json`, `transcript.json`, and `vlm.json` under `chunks/NNN`. When scene detection is disabled, VLM uses one full-duration scene batch; otherwise transcript-aligned scene batches are used. VLM reruns reuse unchanged scene analysis entries by matching each scene id, time range, and frame list. Planning and scripting consume the selected moments and chunk context before producing `clip-plan.json`, `narration.json`, and `timeline.json`.

For PPT-style explainer output, selected long-video moments are expanded into multiple `slide_explainer` storyboard scenes instead of one full-video narration block. `render` auto-selects HyperFrames when every storyboard scene is `slide_explainer`, producing a timed HTML slide project under `renders/hyperframes/`; pass `--hyperframes-render` only when an external HyperFrames CLI is installed and you want it to render that project to a media file. The quality aggregate includes content-structure checks so collapsed outputs, such as one 4 minute scene or one oversized narration segment, fail quality even if the older `quality-report.json` artifact is clean.

Export infers the latest render type when `--format` is omitted: ffmpeg renders export `final.mp4`, HyperFrames HTML renders export the slide project directory, and HyperFrames CLI renders export the generated media file when `--format video` is requested.

Rebuild a stale project from the understanding stage after planner or renderer changes:

```sh
bun run dev rerun <projectId> --from-stage understand
bun run dev quality <projectId> --details
bun run dev render <projectId>
```

Inspect artifacts and quality:

```sh
bun run dev artifacts <projectId>
bun run dev artifacts <projectId> media-info.json
bun run dev artifacts <projectId> --verify
bun run dev events <projectId>
bun run dev quality <projectId>
bun run dev quality <projectId> --details
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
- [Pipeline Split](./docs/architecture.md#business-pipelines): Film Recap and Deck Explainer pipeline split.
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
- Pipeline-specific IR contracts for Film Recap and Deck Explainer flows.
- Text/Markdown and audio-summary to DeckIR-backed PPT-style explainer projects, with optional TTS voiceover timing and DeckIR-to-HTML render artifacts.
- Film Recap ingest, provider-backed source understanding, story-index, clip-plan, cut-first, output-narration, voiceover, source-aware audio mix, subtitle, final render, and quality checkpoints.
- Mock, command, LLM, and Mimo-profile provider configuration.
- LLM-backed ASR/VLM/TTS/storyboard/script provider path through the internal AI SDK-backed `LLMClient`.
- ffmpeg, HTML, and HyperFrames render boundaries, render diagnostics, quality aggregation, export, and quality-gated export.
- CLI, TUI, Fetch API, MCP, and Claude Code skill adapters over the same runtime APIs.

Near-term work:

1. Keep hosted LLM-like services on the shared AI SDK path; add named adapters only for non-LLM or local execution boundaries.
2. Record a real external MCP client validation matrix.
3. Decide whether richer TUI interactions justify adding Ink/Clack runtime dependencies.

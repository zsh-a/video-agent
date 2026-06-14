# Video Agent Architecture

## Goals

`video-agent` is a Bun-first TypeScript video agent. The core system should run without any specific UI or agent shell, while Claude Code skills, MCP, TUI, API, and Web Studio remain adapters on top of the same runtime.

The boundary is:

```text
TypeScript: orchestration, IR, providers, APIs, UI adapters, job state
External binaries: ffmpeg, ffprobe, Chromium, HyperFrames CLI
Not in scope: implementing video encoding, audio mixing, ASR, or VLM inference in TypeScript
```

## Runtime Strategy

The default runtime is Bun for local CLI, worker, workspace IO, SQLite, and subprocess orchestration. Node compatibility remains a design requirement for packages that may run in CI, server deployments, or future TUI adapters.

```text
Development: Bun-first
Local agent: Bun CLI / worker
Production API: Bun or Node after compatibility testing
Terminal UI: may use Node fallback if Ink compatibility becomes an issue
Media: ffmpeg / ffprobe / Chromium as external executors
```

## Layers

```text
Adapters
  CLI / TUI / MCP / API / Web Studio / Claude Code skill

Runtime
  workspace, artifact store, event bus, job runner, queue integration

Core
  typed stages, pipeline orchestration, resumable execution contracts

Domain Packages
  IR, providers, media wrappers, renderers, quality checks, DB schema

Executors
  ffmpeg, ffprobe, Chromium, HyperFrames, provider APIs
```

Adapters can submit commands and render state. They must not own pipeline logic.

## Current Package Layout

```text
packages/
  ir/
    Zod schemas and TypeScript types for timeline, storyboard, narration, jobs, artifacts

  core/
    Stage interface, PipelineContext, event contract, sequential pipeline runner

  runtime/
    Filesystem artifact store, pipeline event bus, workspace, config store, and JobRunner

  media/
    ffmpeg / ffprobe / process wrappers with Bun-first execution and Node fallback

  providers/
    ASR / VLM / TTS provider interfaces

  renderer-ffmpeg/
    First runnable renderer that emits renders/final.mp4 from TimelineIR and subtitles from NarrationIR

  renderer-hyperframes/
    HyperFrames render plan and HTML project compiler boundary

  api/
    Fetch API handler for runtime state, project listing, status, events, artifact reads, render/export actions, and audio preflight diagnostics

  mcp/
    Stdio MCP adapter exposing runtime operations as agent-callable tools

  quality/
    Timeline, narration timing, TTS coverage, subtitle, rendered media, audio loudness, and artifact quality checks

  db/
    Persistence records, JSON-backed JobStore, and configurable Bun SQLite JobStore
```

The existing root oclif CLI remains the first adapter during the initial scaffold. A later migration can move it into `apps/cli` when the core commands are ready.

## Target Adapter Layout

```text
apps/
  cli/       command-line adapter for scripted runs
  worker/    background job execution
  api/       Hono/Fastify API
  tui/       Ink developer workstation
  studio/    Web editor and preview UI

adapters/
  claude-code-skill/
  mcp/
```

These folders should call `@video-agent/core` and `@video-agent/runtime` instead of duplicating workflow behavior. The first MCP adapter currently lives in `packages/mcp` and can later move under `adapters/mcp` if the repository is reorganized around app packages.

## Pipeline Stages

The default workflow is stage-based:

```text
ingest
  validate input, probe media, create workspace

understand
  ASR, OCR/VLM, scene evidence extraction

plan
  build storyboard and timeline candidate

script
  generate narration, bind claims to evidence, wait for review if needed

voiceover
  synthesize TTS, align narration segments

render
  render through HyperFrames or ffmpeg

quality
  inspect timeline bounds, narration timing, TTS coverage, generated subtitles, rendered media streams/duration, audio loudness, black-frame smoke checks, visual smoke checks

export
  copy final video, HyperFrames render directory, or project bundle to a user-selected path
```

Each stage accepts typed input, writes artifacts, emits events, and returns typed output. Stage outputs should be serializable so runs can resume from checkpoint artifacts. The current `JobRunner` runs the initial chain: ingest -> understand -> plan -> script -> voiceover -> quality. CLI runs can resume from a later stage with `run --from-stage` when required artifacts already exist, or with `rerun <projectId> --from-stage` to reuse the input path stored in `job-state.json`. Before resuming, the runtime validates the upstream artifact set for the requested checkpoint and fails without mutating job state when artifacts are missing, changed, or untracked by the artifact manifest. Runtime adapters can use the project quality aggregate to combine pipeline checks, render diagnostics, and artifact integrity into a single deliverability report.

## IR Contracts

IR is the main integration point between agents, renderers, quality checks, and future editors.

```text
StoryboardIR
  scenes, narration hints, visual style, evidence references

TimelineIR
  normalized tracks, item start/duration, source ranges

NarrationIR
  text segments, scene binding, voice hints, timing

ArtifactRef
  typed path + optional content hash
```

All LLM/provider output should be validated before it enters the pipeline state.

## Artifact Strategy

Large media files stay on disk or object storage. The database stores only metadata, paths, hashes, stage status, and provider call records.

```text
workspace/
  projects/<projectId>/
    input/
    frames/
    audio/
    artifacts/
      storyboard.json
      timeline.json
      narration.json
      quality-report.json
    renders/
```

## Provider Strategy

Providers are interfaces first:

```text
ASRProvider
VLMProvider
TTSProvider
AssetProvider
LLMProvider
```

Concrete providers can wrap remote APIs or local services. Local model inference should still be isolated behind the same provider contracts.

## Near-Term Roadmap

1. Improve clip selection and source-range planning.
2. Add Clack prompts for provider `config`.
3. Replace mock ASR/VLM/TTS providers with real provider adapters behind the existing config contract.
4. Add worker-oriented retry scheduling over the configurable `JobStore`.
5. Expand MCP/client integration examples and future TUI surfaces.

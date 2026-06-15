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

The default runtime is Bun for local CLI, worker, workspace IO, SQLite, and subprocess orchestration. Node compatibility remains a design requirement for packages that may run in CI, server deployments, or adapter contexts.

```text
Development: Bun-first
Local agent: Bun CLI / worker
Production API: Bun or Node after compatibility testing
Terminal UI: dependency-light CLI/TUI today; richer UI dependencies require an explicit decision
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
  IR, providers, LLM adapters, media wrappers, renderers, quality checks, DB schema

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
    ASR / VLM / TTS plus storyboard/script business provider interfaces

  llm/
    Internal LLMClient interface, AI SDK config factory, and AI SDK-backed default adapter used by LLM-backed providers

  renderer-ffmpeg/
    First runnable renderer that emits renders/final.mp4 from TimelineIR and subtitles from NarrationIR

  renderer-hyperframes/
    HyperFrames render plan and HTML project compiler boundary

  api/
    Fetch API handler for runtime state, project listing, status, events, artifact reads, render/export actions, and audio preflight diagnostics

  mcp/
    Stdio MCP adapter exposing runtime operations as agent-callable tools

  quality/
    Clip plan consistency, timeline, narration timing, TTS coverage, subtitle, rendered media, audio loudness, and artifact quality checks

  db/
    Persistence records, JSON-backed JobStore, and configurable Bun SQLite JobStore
```

The root oclif CLI remains the primary local adapter. It includes a lightweight `vagent tui` terminal dashboard over runtime state plus controlled artifact inspection, shared guided actions, rerun, and worker recovery actions. A later migration can move it into `apps/cli` or split a richer workstation into `apps/tui` once the package APIs are stable enough to avoid churn.

## Target Adapter Layout

```text
apps/
  cli/       command-line adapter for scripted runs
  worker/    background job execution
  api/       HTTP API wrapper around the dependency-light Fetch handler
  tui/       Ink developer workstation
  studio/    Web editor and preview UI

adapters/
  claude-code-skill/
  mcp/
```

These folders should call `@video-agent/core` and `@video-agent/runtime` instead of duplicating workflow behavior. The first Claude Code skill adapter lives in `adapters/claude-code-skill/video-agent` and documents CLI/MCP workflows for agent shells. The first MCP adapter currently lives in `packages/mcp` and can later move under `adapters/mcp` if the repository is reorganized around app packages.

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
  inspect storyboard source ranges, clip plan consistency, timeline bounds, narration timing, TTS coverage, generated subtitles, rendered media streams/duration, audio loudness, black-frame smoke checks, visual smoke checks

export
  copy final video, HyperFrames render directory, or project bundle to a user-selected path
```

Each stage accepts typed input, writes artifacts, emits events, and returns typed output. Stage outputs should be serializable so runs can resume from checkpoint artifacts. The current `JobRunner` runs the initial chain: ingest -> understand -> plan -> script -> voiceover -> quality. CLI runs can resume from a later stage with `run --from-stage` when required artifacts already exist, or with `rerun <projectId> --from-stage` to reuse the input path stored in `job-state.json`. Before resuming, the runtime validates the upstream artifact set for the requested checkpoint and fails without mutating job state when artifacts are missing, changed, untracked by the artifact manifest, or invalid against the relevant IR schema. Runtime adapters can use the project quality aggregate to combine pipeline checks, render diagnostics, and artifact integrity into a single deliverability report.

## IR Contracts

IR is the main integration point between agents, renderers, quality checks, and future editors.

```text
StoryboardIR
  scenes, narration hints, visual style, evidence references, optional source ranges

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
      clip-plan.json
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
StoryboardProvider
ScriptProvider
AssetProvider
```

Concrete providers can wrap remote APIs, local services, deterministic fallback logic, or `@video-agent/llm`. Runtime stages call business provider interfaces only; they do not call AI SDK or vendor SDKs directly. If workspace config contains an `llm` block, runtime creates an AI SDK-backed `LLMClient` and injects it into the storyboard/script providers; otherwise those providers use deterministic fallbacks. Local model inference should still be isolated behind the same provider contracts.

## Near-Term Roadmap

1. Select the first hosted ASR/VLM/TTS service and implement a real-provider vertical slice behind the existing contracts, using the shared provider descriptor documented in `docs/provider-configuration-model.md`.
2. Validate MCP config output against named external clients and document placement, env injection, config shape, command mode, limitations, and verification dates in a client matrix.
3. Expand real-provider support to additional hosted ASR/VLM/TTS services after the first slice proves the configuration model.
4. Replace the dependency-free TUI guided selector with richer Ink/Clack interactions after the dependency policy is accepted.

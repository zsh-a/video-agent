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
    Filesystem artifact store and pipeline event bus

  media/
    ffmpeg / ffprobe / process wrappers with Bun-first execution and Node fallback

  providers/
    ASR / VLM / TTS provider interfaces

  renderer-hyperframes/
    HyperFrames render plan compiler boundary

  quality/
    Timeline and artifact quality checks

  db/
    Persistence records; later replaced or backed by Drizzle + bun:sqlite
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

These folders should call `@video-agent/core` and `@video-agent/runtime` instead of duplicating workflow behavior.

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
  inspect timeline bounds, subtitles, loudness, visual smoke checks

export
  write final video, artifacts, optional Jianying draft
```

Each stage accepts typed input, writes artifacts, emits events, and returns typed output. Stage outputs should be serializable so runs can resume from checkpoint artifacts.

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

1. Replace demo `hello` commands with `run`, `inspect`, and `render` commands.
2. Add a `Workspace` object that creates project folders and checkpoint files.
3. Implement `ffprobe` media probing and persist `media-info.json`.
4. Add first stage chain: ingest -> plan -> render placeholder.
5. Add Clack prompts for `init` / `config`.
6. Add TUI only after pipeline events and artifact review are stable.

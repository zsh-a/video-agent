# Initial Implementation Plan

This plan defines the first product-quality slice for `video-agent`: a Bun-first TypeScript runtime that can ingest media, create typed artifacts, render a basic output, and stay ready for future TUI, MCP, API, and Web Studio adapters.

## Scope

The first version is not a full video editor. It is a headless agent runtime with a usable CLI.

```text
In scope:
  Bun workspace and TypeScript package boundaries
  Typed IR for media, storyboard, timeline, narration, jobs
  Filesystem workspace and artifact contracts
  ffprobe / ffmpeg wrappers
  Minimal resumable pipeline
  Mock providers behind real provider interfaces
  First ffmpeg renderer
  HyperFrames project generation boundary
  CLI commands for local operation
  Tests around contracts and critical runtime behavior

Out of scope for v0:
  Self-hosted ASR / VLM / TTS inference
  Pure TypeScript video encoding
  Full timeline editor
  Distributed queue
  Production API server
  Heavy TUI
```

## Architecture Principles

1. Core logic must be headless. CLI, TUI, MCP, API, Web Studio, and Claude Code skill adapters should call the same runtime APIs.
2. All cross-stage data must be validated through TypeScript types and Zod schemas.
3. Large media stays in the filesystem or object storage. Job state stores paths, metadata, hashes, and stage status.
4. External executors are replaceable boundaries: `ffmpeg`, `ffprobe`, Chromium, HyperFrames, and provider APIs.
5. Bun is the default runtime, but shared packages should avoid unnecessary Bun-only coupling when a Node fallback is practical.

## Phase 0: Repository Foundation

Goal: make the repository a coherent Bun-first TypeScript project.

Deliverables:

- Root `package.json` with Bun scripts and workspace packages.
- `bun.lock`.
- Shared TypeScript configuration.
- GitHub Actions using Bun.
- `README.md`, `AGENTS.md`, and architecture documentation.

Acceptance criteria:

- `bun install` succeeds.
- `bun run build` succeeds.
- `bun run test` succeeds.
- A new contributor can understand project boundaries from README and docs.

Status: completed.

## Phase 1: Headless Runtime MVP

Goal: run a local media file through a typed, artifact-producing pipeline.

Deliverables:

- `@video-agent/ir` with schemas for media, storyboard, timeline, narration, and jobs.
- `@video-agent/core` with stage and pipeline contracts.
- `@video-agent/runtime` with workspace, artifact store, event bus, config store, project listing, and job runner.
- `@video-agent/media` with Bun-first process execution and `ffprobe` / `ffmpeg` helpers.
- `@video-agent/providers` with ASR, VLM, and TTS interfaces plus mock implementations.
- `@video-agent/quality` with clip plan consistency, timeline, narration timing, and TTS coverage validation.
- Render visual smoke checks with black-frame ratio, multi-point frame samples, and sample content hashes.

Acceptance criteria:

- `vagent run <input>` creates a project workspace.
- The run emits durable events and `job-state.json`.
- The run writes `media-info.json`, `storyboard.json`, `clip-plan.json`, `timeline.json`, `narration.json`, `tts-segments.json`, and `quality-report.json`.
- The pipeline can resume from a later stage when required artifacts already exist.

Status: completed for the first mock-provider slice, including clip plan consistency, timeline bounds, narration timing, TTS coverage, generated SRT subtitle quality checks, rendered media stream/duration diagnostics, ffmpeg audio loudness diagnostics, ffmpeg black-frame smoke checks, rendered first/middle/end thumbnail sampling, thumbnail content-hash static-frame detection, and low visual-variation detection from thumbnail sample sizes.

## Phase 2: Usable CLI Surface

Goal: make the runtime operable without editing files manually.

Deliverables:

- `vagent init` for workspace setup and binary checks.
- `vagent doctor` for runtime, workspace, config, project index, and media tool health checks.
- `vagent config` for local provider/runtime config.
- `vagent provider-env` for provider environment variable requirements and configuration state.
- `vagent inspect` for `ffprobe` artifact creation.
- `vagent run` for the pipeline.
- `vagent projects` for project discovery.
- `vagent status` for current job state.
- `vagent quality` for aggregated project quality, render diagnostics, and artifact integrity.
- `vagent artifacts` for listing and reading artifacts.
- `vagent events` for reading pipeline events and provider call logs.
- `vagent rerun` for re-executing an existing project from a checkpoint stage.
- `vagent worker` for local failed/running job recovery.
- `vagent tui` for a lightweight terminal dashboard over projects, stages, artifacts, and events.
- `vagent serve` for exposing runtime state, provider environment requirements, and controlled workflow actions through HTTP.
- `vagent render` for ffmpeg and HyperFrames-boundary rendering.
- `vagent export` for copying final outputs or project bundles.
- Optional export quality gate that refuses delivery when project quality is not clean.

Acceptance criteria:

- Every command has JSON output where automation needs it.
- Command failures return actionable errors.
- Tests cover workspace path behavior, artifact reads, config updates, job persistence, renderer helpers, and project listing.
- API handler tests cover health, doctor readiness status codes, provider environment reports, project listing, project runs, worker dry-runs, status, events, artifact reads, project reruns, project renders, and project exports.
- API handler tests cover audio preflight diagnostics for render inputs.

Status: completed for local CLI workflows.

## Phase 3: Renderer v0

Goal: produce a basic video output from `TimelineIR`.

Deliverables:

- `@video-agent/renderer-ffmpeg` package.
- SRT generation from `NarrationIR`.
- `final.mp4` render path.
- Optional subtitle burn-in.
- Optional source audio and TTS voiceover mixing.
- Voiceover plan artifact aligned against `NarrationIR`.
- CLI/API audio preflight diagnostics that reuse render options without invoking ffmpeg render.
- Configurable source/voiceover volume and optional sidechain ducking.
- HyperFrames HTML project compiler boundary.
- Optional HyperFrames CLI validate/render execution.

Acceptance criteria:

- `vagent render <projectId>` creates `renders/final.mp4`.
- ffmpeg render mixes available `audio/source.wav` and real TTS segment audio, while skipping missing mock paths.
- ffmpeg render writes `voiceover-plan.json` with aligned start/duration/status for each TTS segment.
- `vagent render <projectId> --inspect-audio` reports available source/voiceover inputs, missing voiceovers, warnings, and the aligned voiceover plan without rendering.
- ffmpeg render can apply source/voiceover volume controls and optional sidechain ducking.
- `vagent render <projectId> --renderer hyperframes` creates `renders/hyperframes/index.html`, `render-plan.json`, and `styles.css`.
- `vagent render <projectId> --renderer hyperframes --hyperframes-validate` invokes the external HyperFrames validator when installed.
- `vagent render <projectId> --renderer hyperframes --hyperframes-render` invokes the external HyperFrames renderer when installed.
- `vagent export` can copy either the final video, HyperFrames directory, or project bundle.
- `vagent export --require-quality` refuses export when the project quality aggregate is not clean.

Status: completed for the first renderer slice, including basic audio mixing, volume controls, optional sidechain ducking, voiceover alignment plans, and CLI/API audio preflight diagnostics.

## Phase 4: Production-Useful Pipeline

Goal: replace placeholder intelligence with configurable provider adapters and stronger media behavior.

Deliverables:

- Command JSON ASR provider adapter behind `ASRProvider`.
- Command JSON VLM provider adapter behind `VLMProvider`.
- Command JSON TTS provider adapter behind `TTSProvider`.
- HTTP JSON ASR/VLM/TTS provider adapters behind the same provider contracts.
- Clip selection and source-range planning improvements.
- Better voiceover placement, voiceover plan artifacts with alignment sources, multi-segment stitching, and ducking controls.
- Provider call records with request identifiers, cost, usage, model, and latency metadata.
- HTTP provider request headers for role/kind/version tracing and fallback request ids.
- Provider environment requirement reports for command and HTTP adapters.
- Interactive prompts for configuration; Clack styling can replace the current readline prompt later.

Acceptance criteria:

- A user can configure external ASR/VLM/TTS command or HTTP adapters without changing source code and inspect the required environment contract without leaking secret values.
- Provider outputs are validated before artifact writes.
- Provider calls are recorded with request id, status, latency, input/output summaries, optional model/usage/cost metadata, and failure details; HTTP providers propagate trace headers and provide fallback request ids when the provider response omits one.
- Project status summarizes events, provider calls, provider costs, quality issues, and render output diagnostics for CLI/API/TUI adapters.
- Project quality gives CLI/API/MCP/TUI adapters one deliverability summary across pipeline checks, render diagnostics, and artifact integrity.
- Project events can be read directly with pipeline stage/type and provider role/status filters for future CLI/API/TUI/MCP adapters.
- Rendered output includes usable voiceover or a clear missing-audio diagnostic and voiceover alignment plan.

Status: in progress. The command and HTTP JSON provider boundaries, runnable command-provider and HTTP-provider recipes, provider smoke tests, HTTP provider trace headers, provider call records, request ids, optional cost/usage/model metadata, provider environment requirement reports, first `clip-plan.json` source-range planning artifact, voiceover plan artifacts, missing-audio diagnostics, render audio preflight checks, multi-chunk TTS stitching, and lightweight interactive configuration are implemented; provider-specific hosted-service adapters and Clack-styled prompts are still pending.

## Phase 5: Persistence and Recovery

Goal: make job state robust enough for long-running work.

Deliverables:

- Bun SQLite-backed implementation of the existing job store contract.
- Runtime configuration for selecting `json` or `sqlite` job state storage.
- Stage checkpoint metadata.
- Stage retry policy and resumability rules.
- Artifact manifest, content hash tracking, and integrity checks.
- Worker recovery attempt limits and skip reasons.

Acceptance criteria:

- JSON-backed storage can still be used for simple local runs or tests.
- SQLite job state can be selected through runtime config and recover after process interruption.
- Artifact files have a manifest with stable sha256 hashes and a CLI/API integrity check for recovery decisions.
- Stage retries can be configured and emit attempt-aware events.
- Checkpoint reruns fail before job-state mutation when required upstream artifacts are missing, changed, or untracked by the artifact manifest.
- Worker recovery can skip jobs that reached a configured stage attempt ceiling and explain skipped jobs.
- Re-running a stage does not corrupt unrelated artifacts.

Status: completed for local persistence and recovery. JSON storage remains the default runtime path, Bun SQLite storage can be selected with `config --job-store sqlite`, artifacts include a sha256 manifest, stage retries are configurable, checkpoint artifact existence/integrity validation is implemented, and local/API/MCP/TUI worker recovery can recover failed/running jobs from the first unfinished stage. Worker recovery supports candidate ordering, `runningStaleAfterMs` protection for still-active running jobs, checkpoint artifact preflight, `maxAttempts`, and skip reasons for checkpoint issues, attempt limits, processing limits, active running jobs, and non-recoverable jobs.

## Phase 6: Agent and Product Adapters

Goal: expose the same core runtime to multiple interaction layers.

Deliverables:

- MCP server for `doctor`, `provider-env`, `run`, `status`, `events`, `artifacts`, `render`, `worker`, and `export`.
- Lightweight TUI for project selection, stage status, logs, artifact review, and reruns.
- API server for Web Studio and batch jobs.
- Claude Code skill that shells out to the CLI or MCP server.

Acceptance criteria:

- Adapters do not duplicate pipeline logic.
- Each adapter can operate on an existing project workspace.
- Long-running operations expose status and logs.

Status: in progress. A first stdio MCP adapter is implemented with tools for doctor, provider environment reports, provider smoke tests, project listing, status, events, artifacts, artifact verification, run, rerun, render, audio inspection, visual sample inspection, worker recovery, and export. MCP render/audio tools expose the same ffmpeg volume, ducking, and HyperFrames command options used by the CLI/API adapters, and tool argument schemas include client-facing descriptions for external agent UIs. The MCP command can print reusable stdio config JSON with server naming, installed/dev command mode, server-only snippets, and explicit env injection. The API exposes provider environment reports, provider smoke tests, non-secret runtime config, visual sample metadata, `POST /worker` recovery, and a dependency-free `GET /studio` Web Studio shell over project/status/quality/artifact/event endpoints with render, quality-gated export, stage-scoped rerun, worker dry-run actions, provider smoke-test actions, provider/config visibility, ffmpeg/HyperFrames render option controls, inline JSON/text artifact preview, rendered visual sample preview, template-quality diagnostics from `render-output.json`, render-quality diagnostics, and artifact integrity drilldowns. A first lightweight `vagent tui` dashboard is implemented for project selection, stage status, quality/render summaries, artifact review, recent events, watch refresh, command suggestions, artifact inspection, provider smoke tests, controlled project reruns, and worker recovery. HyperFrames renders now include local template-quality checks for generated HTML/CSS/render-plan structure before optional external CLI validation. A first Claude Code skill adapter is available under `adapters/claude-code-skill/video-agent`, and agent-client installation checks are documented in `docs/agent-client-checks.md`.

## Immediate Next Tasks

Recommended order:

1. Replace the readline interactive config with Clack-styled prompts when dependency policy allows it.
2. Add real-service ASR/VLM/TTS adapters behind the existing provider contracts.
3. Extend TUI command suggestions into an interactive guided selector when dependency policy allows Ink or Clack.
4. Test the generic MCP config output against named external clients and document any client-specific placement details.
5. Add named external client placement notes after hands-on checks against each target host.
6. Add named hosted-service provider adapters once target services are selected.

## v0 Completion Definition

The first implementation version is complete when:

- The project can be installed and tested with Bun.
- A local media file can be inspected, run through the pipeline, rendered, and exported from CLI commands.
- Artifacts and job state are durable and inspectable.
- The architecture is documented well enough to add real providers without changing the pipeline shape.
- Tests cover the contracts most likely to break future adapters.

Current evidence: `test/commands/cli-e2e.test.ts` exercises workspace bootstrap through `init`, `config`, `provider-env`, `provider-test`, and `doctor`, then generates a short local media file with ffmpeg and exercises the development CLI through `inspect`, `run`, `render --no-audio --no-subtitles`, `export`, `artifacts --verify`, and `status` against one workspace.

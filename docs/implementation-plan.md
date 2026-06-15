# Historical Implementation Plan

This document is historical context for the first product-quality slice. It is not the source of truth for the current command surface or adapter details.

Use these documents for current behavior:

- [README](../README.md) for onboarding and current status.
- [Architecture](architecture.md) for package boundaries.
- [Provider Configuration Model](provider-configuration-model.md) for runtime provider config.
- [Agent Client Checks](agent-client-checks.md) for MCP and external agent validation.

The original plan defined a Bun-first TypeScript runtime that can ingest media, create typed artifacts, render a basic output, and stay ready for TUI, MCP, API, Web Studio, and skill adapters.

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
4. External executors are replaceable boundaries: `ffmpeg`, `ffprobe`, Chromium, HyperFrames, AI SDK-backed hosted models, and local command adapters.
5. Bun is the project runtime. Shared packages can use Bun APIs directly when they reduce complexity; alternate JavaScript runtimes are not a design target.

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
- Render visual smoke checks with black-frame ratio, multi-point frame samples, sample timestamp bounds, and sample content hashes.

Acceptance criteria:

- `vagent run <input>` creates a project workspace.
- The run emits durable events and `job-state.json`.
- The run writes `media-info.json`, `storyboard.json`, `clip-plan.json`, `timeline.json`, `narration.json`, `tts-segments.json`, and `quality-report.json`.
- The pipeline can resume from a later stage when required artifacts already exist.

Status: completed for the first mock-provider slice, including clip plan consistency, timeline bounds, narration timing, TTS coverage, generated SRT subtitle quality checks, rendered media stream/duration diagnostics, ffmpeg audio loudness diagnostics, ffmpeg black-frame smoke checks, rendered first/middle/end thumbnail sampling, thumbnail timestamp bounds checks, thumbnail content-hash static-frame detection, and low visual-variation detection from thumbnail sample sizes.

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
- API handler tests cover health, doctor readiness status codes, provider environment reports, project listing, project runs, worker dry-runs, status, events, artifact reads, project reruns, invalid IR validation errors, project renders, and project exports.
- API handler tests cover audio preflight diagnostics for render inputs.

Status: completed for local CLI workflows, including structured checkpoint failure output for `run --from-stage` and `rerun --from-stage` in JSON mode, human-readable artifact issue lists in terminal mode, and shared doctor pass/warn/fail summaries across CLI/API/MCP.

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
- LLM-backed ASR/VLM/TTS providers behind the same provider contracts.
- Clip selection and source-range planning improvements.
- Better voiceover placement, voiceover plan artifacts with alignment sources, multi-segment stitching, and ducking controls.
- Provider call records with request identifiers, cost, usage, model, and latency metadata.
- Provider environment requirement reports and shell templates for command adapters.
- Clack-styled interactive prompts for configuration with a non-TTY guard for scripts and agent clients.
- `@video-agent/llm` with an internal `LLMClient` interface, latest AI SDK-backed default adapter, and minimal AI SDK provider config factory for Anthropic-compatible and OpenAI-compatible endpoints.
- `StoryboardProvider` and `ScriptProvider` business interfaces with deterministic fallbacks and LLM-backed implementations for plan/script stages.

Acceptance criteria:

- A user can configure external ASR/VLM/TTS command adapters or the shared LLM path without changing source code and inspect the required environment contract without leaking secret values.
- Provider outputs are validated before artifact writes and during checkpoint/artifact verification, with structured validation issues for smoke-test diagnostics.
- Provider calls are recorded with request id, status, latency, input/output summaries, optional model/usage/cost metadata, and failure details.
- Project status summarizes events, provider calls, provider costs, quality issues, and render output diagnostics for CLI/API/TUI adapters.
- Project quality gives CLI/API/MCP/TUI adapters one deliverability summary across pipeline checks, render diagnostics, and artifact integrity.
- Project events can be read directly with pipeline stage/type and provider role/status filters for future CLI/API/TUI/MCP adapters.
- Rendered output includes usable voiceover or a clear missing-audio diagnostic and voiceover alignment plan.

Status: in progress. The command JSON provider boundary, runnable command-provider recipe, LLM-backed ASR/VLM/TTS/storyboard/script providers, provider smoke tests with structured provider response validation diagnostics and shared summary counts, provider call records, request ids, optional cost/usage/model metadata, provider environment requirement reports with shared summary counts, non-secret shell templates, config-time provider env summaries, explicit env injection across CLI/API/MCP provider and doctor checks, shared ASR/VLM/TTS artifact schemas, transcript-aligned VLM scene batches, ASR/VLM evidence-backed storyboard generation with scene-level source ranges, storyboard sourceRange quality checks, sequential fallback `clip-plan.json` source-range planning with gap/overlap diagnostics, Zod validation for runtime-generated and checkpoint-loaded IR/provider artifacts, voiceover plan artifacts, missing-audio diagnostics, render audio preflight checks, multi-chunk TTS stitching, Clack-styled interactive configuration, the shared provider configuration descriptor documented in `docs/provider-configuration-model.md`, the latest AI SDK-backed `@video-agent/llm` abstraction, config-driven AI SDK LLM client creation, and MiMo ASR over the AI SDK OpenAI-compatible path are implemented. Hosted LLM-like services should continue to use this shared AI SDK path instead of provider-specific HTTP adapters.

## Phase 5: Persistence and Recovery

Goal: make job state robust enough for long-running work.

Deliverables:

- Bun SQLite-backed implementation of the existing job store contract.
- Runtime configuration for selecting `json` or `sqlite` job state storage.
- Stage checkpoint metadata.
- Stage retry policy and resumability rules.
- Artifact manifest, content hash tracking, integrity checks, and known IR/provider artifact schema checks.
- Worker recovery attempt limits and skip reasons.

Acceptance criteria:

- JSON-backed storage can still be used for simple local runs or tests.
- SQLite job state can be selected through runtime config and recover after process interruption.
- Artifact files have a manifest with stable sha256 hashes and a CLI/API integrity/schema check for recovery decisions.
- Stage retries can be configured and emit attempt-aware events.
- Checkpoint reruns fail before job-state mutation when required upstream artifacts are missing, changed, untracked by the artifact manifest, or invalid against their IR/provider schema.
- Worker recovery can skip jobs that reached a configured stage attempt ceiling and explain skipped jobs.
- Re-running a stage does not corrupt unrelated artifacts.

Status: completed for local persistence and recovery. JSON storage remains the default runtime path, Bun SQLite storage can be selected with `config --job-store sqlite`, artifacts include a sha256 manifest with shared integrity summary counts, stage retries are configurable, checkpoint artifact existence/integrity/schema validation is implemented, and local/API/MCP/TUI worker recovery can recover failed/running jobs from the first unfinished stage. Worker recovery supports candidate ordering, `runningStaleAfterMs` protection for still-active running jobs, checkpoint artifact/schema preflight, validation issue reporting in JSON and human-readable CLI/TUI output, `maxAttempts`, and skip reasons for checkpoint issues, attempt limits, processing limits, active running jobs, and non-recoverable jobs.

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

Status: in progress. A first stdio MCP adapter is implemented with tools for doctor, provider environment reports, provider smoke tests, shared guided actions, project listing, status, events, artifacts, artifact verification, run, rerun, render, audio inspection, visual sample inspection, worker recovery, and export. MCP render/audio/export tools expose the same ffmpeg volume, ducking, HyperFrames command, quality gate, and clean directory export options used by the CLI/API adapters, the MCP/API quality endpoints can include raw quality/render artifacts for deep diagnostics, guided action parameters are aligned across API/MCP/TUI including artifact preview limits, tool argument schemas include client-facing descriptions for external agent UIs, and runtime checkpoint/schema/export-quality failures include structured JSON-RPC `error.data`. The MCP command can print reusable stdio config JSON with server naming, installed/dev command mode, full/server-entry shape selection, named client presets, preset placement info, preset discovery output, and explicit env injection. The API exposes provider environment reports, provider smoke tests, non-secret runtime config, shared guided actions, visual sample metadata, `POST /worker` recovery, structured `409` checkpoint errors for missing/changed/untracked/schema-invalid artifacts, structured export quality gate errors with project quality reports, clean directory export, and a dependency-free `GET /studio` Web Studio shell over project/status/quality/action/artifact/event endpoints with render, quality-gated export, stage-scoped rerun, worker dry-run actions, provider smoke-test actions, provider/config visibility, ffmpeg/HyperFrames render option controls, export format/output/quality/clean controls, inline JSON/text artifact preview, rendered visual sample preview, guided action copy, structure-aware action error summaries, template-quality diagnostics from `render-output.json`, render-quality diagnostics, and artifact integrity drilldowns. A first lightweight `vagent tui` dashboard is implemented for project selection, stage status, quality/render summaries, artifact integrity summaries, artifact review, recent events, watch refresh, guided command metadata, dependency-free guided action selection, controlled status inspection, artifact inspection, controlled artifact manifest/schema verification, filtered pipeline/provider event inspection, quality details with optional raw quality/render artifacts, audio preflight diagnostics, visual sample inspection, provider smoke tests, controlled project reruns with structured checkpoint failure output, controlled render with ffmpeg/HyperFrames options, controlled quality-gated export with clean directory options, and worker recovery. HyperFrames renders now include local template-quality checks for generated HTML/CSS/render-plan structure before optional external CLI validation. A first Claude Code skill adapter is available under `adapters/claude-code-skill/video-agent`, and agent-client installation checks are documented in `docs/agent-client-checks.md`.

## Historical Next Tasks

These were the recommended tasks when this plan was active. Treat them as backlog context, not as canonical current status:

1. Keep hosted ASR/VLM/TTS services on the shared AI SDK-backed LLM path. Provider-specific protocol differences should be handled in `packages/llm` with request transforms and no-network tests.
2. Create a named MCP client validation matrix for the generic config output. Test each target client hands-on, then document config shape, placement path, env injection behavior, installed/dev command mode, observed limitations, and verification date in one place.
3. Add named providers only for non-LLM/local execution boundaries after the configuration model and validation matrix are stable.
4. Replace the dependency-free TUI guided selector with richer Ink/Clack interactions after the dependency policy is explicitly accepted. This is an experience upgrade and should not block real-provider or MCP-client validation work.

## v0 Completion Definition

The first implementation version is complete when:

- The project can be installed and tested with Bun.
- A local media file can be inspected, run through the pipeline, rendered, and exported from CLI commands.
- Artifacts and job state are durable and inspectable.
- The architecture is documented well enough to add real providers without changing the pipeline shape.
- Tests cover the contracts most likely to break future adapters.

Current evidence: `test/commands/cli-e2e.test.ts` exercises workspace bootstrap through `init`, `config`, `provider-env`, `provider-test`, and `doctor`; validates command provider env, LLM profile doctor checks, explicit `--env` injection for provider and doctor checks, MCP client config output, and the documented command adapter recipe through CLI-level smoke tests; then generates a short local media file with ffmpeg and exercises the development CLI through `inspect`, `run`, `render --no-audio --no-subtitles`, `export`, `artifacts --verify`, and `status` against one workspace. `test/packages/api/server.test.ts` and `test/packages/mcp/server.test.ts` validate explicit env injection for provider and doctor checks through API and MCP adapters. `test/packages/runtime/provider-smoke-test.test.ts` also validates the LLM provider path with an injected LLM client.

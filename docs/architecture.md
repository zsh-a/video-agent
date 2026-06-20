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

The runtime is Bun for local CLI, worker, workspace IO, SQLite, subprocess orchestration, API, and adapter contexts.

```text
Development: Bun
Local agent: Bun CLI / worker
Production API: Bun
Terminal UI: dependency-light CLI/TUI; Web Studio uses a React/Tailwind static frontend
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
  IR, business pipelines, providers, LLM adapters, media wrappers, renderers, quality checks, DB schema

Executors
  ffmpeg, ffprobe, Chromium, HyperFrames, AI SDK-backed hosted models, local command adapters
```

Adapters can submit commands and render state. They must not own pipeline logic.

## Business Pipelines

The product is modeled as two business pipelines over the same runtime, provider, media, IR, renderer, artifact, checkpoint, and quality layers.

```text
vagent-core
  Job Runtime / Event Bus / Checkpoint
  Artifact Store
  Provider Layer: ASR / VLM / LLM / TTS / Asset
  Media Layer: ffmpeg / ffprobe / Chromium
  IR Layer: StoryIR / TimelineIR / DeckIR / RenderIR
  Renderer Layer: FFmpeg / HTML / HyperFrames / Remotion / Jianying
```

The pipelines differ by what owns the primary timeline:

```text
Film Recap Pipeline
  Media-first, evidence-first, cut-first.
  The source video is the main visual, and narration is written against the edited output timeline.

Deck Explainer Pipeline
  Content-first, deck-first, voice-driven.
  The content structure is the main line, and visuals are generated as slides, diagrams, charts, images, and animation.
```

Do not force both products into one generic `ingest -> understand -> plan -> script -> render` flow. The shared runtime should provide execution, workspace, artifact, checkpoint, event, and job facilities, but each business pipeline owns its own stage graph, first-class IR flow, provider calls, renderer orchestration, and quality gates.

Pipeline packages expose the business orchestration surface while reusing shared runtime facilities:

```text
packages/
  pipeline-film/    film recap orchestration over runtime/core/media/providers/renderers
  pipeline-deck/    deck explainer orchestration over runtime/core/providers/renderer-deck/renderers
```

## Package Layout

```text
packages/
  ir/                 Zod schemas and TypeScript types for timeline, storyboard, narration, jobs, artifacts
  core/               Stage interface, PipelineContext, event contract, sequential pipeline runner
  runtime/            Filesystem artifact store, pipeline event bus, workspace, config store, and JobRunner
  media/              ffmpeg / ffprobe / process wrappers with Bun subprocess execution
  providers/          ASR / VLM / TTS plus storyboard/script business provider interfaces
  llm/                Internal LLMClient interface, AI SDK config factory, and AI SDK-backed default adapter
  renderer-ffmpeg/    Emits renders/final.mp4 from TimelineIR and subtitles from NarrationIR
  renderer-deck/      Shared DeckIR React/Tailwind templates, theme CSS, Shiki code highlighting, template manifest, and MotionIR compiler
  renderer-html/      Browser HTML/Playwright capture boundary over shared deck templates
  renderer-hyperframes/ HyperFrames render plan and HTML project compiler boundary
  renderer-motion-canvas/ DeckIR + MotionIR to Motion Canvas project compiler boundary for technical diagram scenes
  renderer-remotion/  DeckIR + MotionIR to Remotion project compiler boundary; Remotion CLI remains an optional external executor
  api/                Fetch API handler for runtime state, project operations, and audio preflight diagnostics
  studio/             React/Tailwind Web Studio frontend served as static API assets
  mcp/                Stdio MCP adapter exposing runtime operations as agent-callable tools
  quality/            Clip plan consistency, timeline, narration timing, TTS coverage, subtitle, rendered media, audio loudness, and artifact quality checks
  db/                 Persistence records, JSON-backed JobStore, and configurable Bun SQLite JobStore
```

The root oclif CLI remains the primary local adapter. Business workflow entry points are explicit pipeline commands such as `film` and `deck`; generic adapter commands inspect state, render ffmpeg timelines, export artifacts, rerun supported checkpoints, and recover worker jobs through runtime APIs. The interactive Ink `vagent tui` manager sits over runtime state, project navigation, artifact inspection, events, guided commands, rerun, render/export, and worker recovery actions. Web Studio is a React/Tailwind read-first review desk over the same API surfaces for status, artifacts, keyframes, quality issues, provider calls, and LLM traces, with rerun/render/export kept behind explicit project-operation controls. `packages/studio` owns browser UI composition only; `packages/api` serves the static build and remains the runtime JSON adapter. Non-TTY, `--json`, `--watch`, and `--no-interactive` paths keep the script-friendly dashboard/action output. Dynamic terminal UI code must stay in the CLI adapter and consume runtime APIs/events instead of owning workflow behavior.

## Target Adapter Layout

```text
apps/
  cli/       command-line adapter for scripted runs
  worker/    background job execution
  api/       HTTP API wrapper around the dependency-light Fetch handler
  tui/       Ink developer workstation
  studio/    Web review desk and preview UI

adapters/
  claude-code-skill/
  mcp/
```

These folders should call `@video-agent/core`, `@video-agent/runtime`, and the pipeline packages instead of duplicating workflow behavior.

## Shared Stage Runtime

The runtime owns jobs, events, checkpoints, artifacts, workspace IO, provider setup helpers, and shared render/export utilities. Business stage graphs live in pipeline packages instead of a generic "initial" pipeline or runtime monolith. Film Recap and Deck Explainer declare their own stage lists and checkpoint artifact sets; adapters call pipeline/runtime APIs rather than building workflow behavior locally.

Each stage accepts typed input, writes serializable artifacts, emits events, and returns typed output. Film jobs can resume from supported checkpoint stages with `rerun <projectId> --from-stage` or worker recovery. Deck recovery is handled through dedicated deck commands rather than generic rerun. Before resuming, the runtime validates the upstream artifact set and fails without mutating job state when artifacts are missing, changed, untracked, or invalid against the relevant IR schema.

## Film Recap Pipeline

Film recap is for TV, movie, and long-video editing commentary. The production path requires source audio, timed ASR, VLM evidence, a recap script, script-driven clips, and script-sourced narration; missing production inputs are hard failures rather than silent degraded output. Its stage graph is media-first and cut-first:

```text
input video
  -> ingest / probe
  -> source understanding (ASR + VLM)
  -> story index / narrative beats
  -> recap script (third-person narration over story beats)
  -> clip planning (script-driven, evidence-backed hard failure)
  -> render cut
  -> narrate against cut output timeline
  -> voiceover / subtitles / audio mix
  -> render / export
  -> quality check
```

Important rule: do not write final narration by pasting raw source dialogue or by falling back to beat summaries. The pipeline first writes `recap-script.json` as third-person commentary over story beats, then uses that script to drive `clip-plan.json`. After rendering `edited_source.mp4`, it writes `output_timeline_map.json` and binds the script narration to the edited output timeline. If a clip or narration segment cannot be traced back to `recap-script.json`, the stage fails.

Film-specific IR lives in `packages/ir/src/film.ts`: `FilmScene`, `ASRSegment`, `VLMSceneAnalysis`, `StoryIndex`, `NarrativeBeat`, `RecapScript`, `OutputTimelineMap`, and `OutputNarration`.

Quality checks focus on source/output timeline consistency, evidence-backed clip choice, narration alignment to the edited output, speech overlap, ducking decisions, subtitle bounds, loudness, and render diagnostics.

## Deck Explainer Pipeline

Deck explainer is for text, article, podcast, audio, tutorial, research, product, or meeting material that becomes a PPT-style video. Its stage graph is content-first and deck-first:

```text
text / audio
  -> content ingest
  -> source map / transcript normalize
  -> LLM content analysis
  -> LLM deck brief
  -> LLM slide outline
  -> LLM slide plan
  -> LLM script + semantic metadata
  -> coverage + script timing preflight
  -> deterministic DeckIR artifact build
  -> TTS synthesis / timing repair
  -> Template + Theme + MotionPreset
  -> visual preflight
  -> Remotion silent video / SRT sidecar / ffmpeg mux
  -> review
```

Two modes:

- **script-generated**: Input text/audio is summarized and rewritten, then new TTS drives slide timing.
- **audio-anchored**: Original audio is preserved; ASR timestamps drive chapter segmentation and slide alignment.

Deck-specific IR lives in `packages/ir/src/deck.ts`: `Document`, `ContentBlock`, `Outline`, `Deck`, `Slide`, `SpeakerScript`, `SlideTiming`, and `TimedDeck`. `Slide` is semantic: it chooses a controlled slide type (`hero`, `three-points`, `comparison`, `process`, `timeline`, `quote`, `stat`, `chart`, `code`, `summary`, `cta`) plus structured content and a motion preset. LLM providers generate DeckIR only; they do not generate HTML, CSS, absolute positions, fonts, colors, or animation curves.

LLM text planning is staged rather than a single all-purpose deck prompt. `@video-agent/pipeline-deck` first builds a deterministic source map with structural section ids and line ranges, asks the LLM for source-grounded content analysis, asks for a deck brief with required section coverage, asks for a slide outline with narration budgets, then passes the approved outline plus the renderer template manifest to the slide-plan call. A separate script-semantics call writes speaker notes, semantic metadata, source ranges, durations, and transitions against the approved slide plan. The deterministic builder merges those stage outputs into the same final DeckIR-adjacent plan object, writes coverage and script timing reports, and fails before render when required source sections are not covered or narration is too dense for the planned slide duration. Long source text and oversized transcript batches are chunked for content analysis, merged by a separate content-analysis merge call, and only then sent to brief/outline planning.

Voiceover generation remains generation-aware instead of treating TTS as a black box. TTS segment durations are compared against LLM-authored script estimates in `deck-timing-report.json`; large drift fails timing repair instead of silently stretching slide timing. Concatenated voiceover audio is normalized with ffmpeg loudness filtering, and subtitle quality checks include cue duration and line-length readability diagnostics.

Template selection is manifest-driven. `packages/renderer-deck/src/deck/templates/manifest.ts` is the source of truth for built-in template `type`, `use_when`, supported fields, content limits, allowed motion presets, repair strategy, and template quality rules. Runtime planning passes this manifest only to the slide-plan LLM stage as `target.templateManifest`; prompts require the LLM to choose only from that manifest, split over-limit content into multiple slides, and avoid mixing unrelated themes on one page. Runtime normalization enforces the same limits before creating DeckIR. Invalid output fails validation and is routed back to the responsible LLM stage as structured issues; the runtime does not silently split, trim, downgrade, or infer semantic content.

`packages/renderer-deck` owns the reusable DeckIR presentation system:

```text
DeckIR + TimedDeck
  -> template manifest        LLM-facing type catalog, limits, repair, quality rules
  -> React templates          predefined semantic slide components
  -> renderToStaticMarkup     static slide DOM, no hydration
  -> Tailwind CSS             scanned utility CSS for generated markup
  -> Shiki highlighting       static HTML code highlighting for code slides
  -> theme tokens             fixed canvas, safe area, typography, color system
  -> MotionIR                 renderer-agnostic property tracks in packages/ir
```

The HTML renderer adds a browser runtime (`window.vagent.seek(t) / play() / pause()`) for Playwright/Chromium inspection and frame capture. The Remotion renderer imports the same React templates through the browser-safe `@video-agent/renderer-deck/remotion` entry and evaluates scene timing per frame inside the Remotion composition.

Deck motion presets are authoring hints, not renderer contracts. The shared deck package compiles them into `MotionTimeline` tracks such as opacity, translate, scale, and blur. HTML, Remotion, Motion Canvas, or other animation backends should consume the same MotionIR instead of adding backend-specific animation concepts to DeckIR.

Template source is intentionally layered:

```text
deck/layout/       fixed-canvas primitives: stage, slide frame, safe area, grid, stack, split, center, card, background
deck/components/   reusable visual blocks split by component, with an index export
deck/templates/    define-template, registry, and one module per slide type selected by DeckIR slide.type
deck/themes/       design tokens and theme CSS generation
deck/motion.ts     deterministic motion presets compiled into a seekable timeline
```

Templates compose lower layers and declare semantic structure only. `deck/templates/registry.tsx` is the renderer-side catalog for template modules; `template-manifest.ts` remains the LLM-facing catalog of allowed choices, limits, repair behavior, and quality rules. Themes own style tokens, motion presets own animation behavior, and LLM output remains limited to DeckIR fields selected from the manifest.

The primary renderer for this pipeline is Remotion. `@video-agent/pipeline-deck` compiles DeckIR plus MotionIR into a Remotion composition under `renders/remotion/`, renders a silent H.264 video with `imageFormat=jpeg`, `jpegQuality=85`, `x264Preset=veryfast`, and `concurrency=75%`, then uses ffmpeg to mux voiceover audio and `mov_text` subtitles into `renders/final.mp4`. The static React HTML renderer is retained as an explicit fallback through `renderer: "html"` or CLI `--renderer html`; it is best suited for compatibility, inspection, and keyframe visual QC rather than default full-video rendering. The HTML path can capture Playwright or Chromium frame sequences, write `deck-frame-manifest.json`, reuse existing non-empty frames, plan shards with `--plan-shards`, run shard batches with retry, and finalize from complete frame manifests. A Remotion final render removes stale HTML frame artifacts so interrupted browser-frame renders do not pollute the artifact manifest. HyperFrames remains an optional backend for compatible HTML project rendering. `createDeckRendererBackendProject` and CLI `deck export-backend` compile the same DeckIR plus MotionIR into standalone Remotion or Motion Canvas projects and record `deck-renderer-remotion.json` or `deck-renderer-motion-canvas.json`. `createDeckRemotionRenderProject` and CLI `deck render-backend --backend remotion` still run an explicit external Remotion command inside `renders/remotion/`, expect `out/final.mp4` by default, and record `deck-renderer-remotion-output.json`.

Quality checks focus on text density, safe area, title overflow, visual hierarchy, contrast, slide/audio timing, subtitle overlap, chart/source evidence, repeated slides, and empty slides.

## Long-Video Strategy

Long source videos use a chunk-first plan instead of sending the whole file through one ASR/VLM/script context. The runtime's retries, checkpoint validation, artifact manifests, and stage reruns are the foundation.

Default planning parameters:

```text
chunkDuration: 300 seconds
chunkOverlap: 10 seconds
frameSampleFps: 1
vlmFrameSampleFps: 0.2
sceneDetection: true
asrChunking: true
vlmBatchSize: 16
```

Key design points:

- `chunk-plan.json` divides the source into non-overlapping content ranges plus overlapping analysis ranges.
- Per-chunk artifacts (`chunks/NNN/`) are first-class: transcript, VLM, silence, and summary.
- Chunked ASR/VLM reruns reuse valid per-chunk artifacts before calling providers again.
- Scene detection batches are transcript-aligned when enabled; one full-duration VLM batch when disabled.
- Planning stages work from chunk and chapter summaries, then select evidence-backed moments for scripting and rendering.
- Selected moments are split into PPT-like `slide_explainer` storyboard scenes for explainers, avoiding a single full-video scene.

## IR Contracts

IR is the main integration point between agents, renderers, quality checks, and future editors.

```text
StoryboardIR        scenes, narration hints, visual style, evidence references, optional source ranges
TimelineIR          normalized tracks, item start/duration, source ranges
NarrationIR         text segments, scene binding, voice hints, timing
ArtifactRef         typed path + optional content hash

LongVideoChunkPlan  source duration, chunk defaults, content ranges, analysis ranges
LongVideoChunk*     per-chunk summaries, silence, chapters, global outline, selected moments

Film Recap IR       SceneIR, ASRSegmentIR, VLMSceneIR, StoryIndexIR, NarrativeBeatIR, OutputTimelineMapIR, OutputNarrationIR
Deck Explainer IR   DocumentIR, ContentBlockIR, SourceMapIR, ContentAnalysisIR, DeckBriefIR, SlideOutlineIR, DeckIR, SlideIR, SpeakerScriptIR, SlideTimingIR
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
      chunk-plan.json
      frames.json
      chunk-summaries.json
      chapters.json
      global-outline.json
      selected-moments.json
      source-map.json
      content-analysis.json
      deck-brief.json
      slide-outline.json
      slide-plan.json
      script-semantics.json
      deck-coverage-report.json
      script-timing-report.json
      deck-timing-report.json
      scene-batches.json
      storyboard.json
      clip-plan.json
      timeline.json
      narration.json
      quality-report.json
      chunks/
        000/
          transcript.json
          vlm.json
          silence.json
          summary.json
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

Concrete providers can wrap local command adapters, `@video-agent/llm`, or provider-specific media-producing endpoints. Runtime stages call business provider interfaces only; they do not call AI SDK or vendor SDKs directly. Semantic understanding and generation must not use deterministic fallback logic: Film Recap and Deck Explainer story summaries, selected moments, storyboard/deck content, script/narration, narrative beat classification, and semantic clip selection come from LLM/VLM structured outputs. Deterministic TypeScript logic is limited to media, evidence, validation, and timeline orchestration.

If workspace config contains an `llm` block, runtime creates an AI SDK-backed `LLMClient` and injects it into ASR/VLM/storyboard/script providers that select `llm`. Hosted LLM-like services should be added through `packages/llm` provider config and AI SDK transforms when possible. Binary media endpoints such as MiMo TTS stay behind provider interfaces when they need to write artifacts directly.

## Near-Term Roadmap

1. Keep hosted ASR/VLM model endpoints on the shared AI SDK-backed `LLMClient` path.
2. Validate MCP config output against named external clients and document a client matrix.
3. Add named providers only for non-LLM/local execution boundaries.
4. Continue moving richer terminal interactions into adapter-only Ink/Clack surfaces without adding workflow ownership to the UI layer.

Production provider work should keep call observability first-class. Runtime writes `provider-calls.jsonl` for individual ASR/VLM/TTS/script calls and `llm-traces.jsonl` for traced LLM operations, then exposes a shared provider report for CLI, API, and MCP adapters so hosted runs can be audited by role, provider, model, operation, cost, usage, latency, and failure state without duplicating aggregation logic in adapters.

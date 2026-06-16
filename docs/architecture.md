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

The runtime is Bun for local CLI, worker, workspace IO, SQLite, subprocess orchestration, API, and adapter contexts. Packages use Bun APIs for runtime file IO, environment access, subprocess orchestration, and server startup; project behavior and tests target Bun only.

```text
Development: Bun
Local agent: Bun CLI / worker
Production API: Bun
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
  IR, business pipelines, providers, LLM adapters, media wrappers, renderers, quality checks, DB schema

Executors
  ffmpeg, ffprobe, Chromium, HyperFrames, AI SDK-backed hosted models, local command adapters
```

Adapters can submit commands and render state. They must not own pipeline logic.

## Business Pipelines

The product should be modeled as two business pipelines over the same runtime, provider, media, IR, renderer, artifact, checkpoint, and quality layers.

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

Do not force both products into one generic `ingest -> understand -> plan -> script -> render` flow. The shared runtime should execute typed stages, but each business pipeline chooses its own stage graph and first-class IR.

Pipeline facade packages now expose the business orchestration surface while reusing the shared runtime implementations:

```text
packages/
  pipeline-film/    film recap orchestration facade over runtime/core/media/providers/renderers
  pipeline-deck/    deck explainer orchestration facade over runtime/core/providers/renderer-html
```

The current facade packages are intentionally thin: they define the adapter-facing business boundary first, while the stage implementations remain in `packages/runtime` until the package APIs are stable enough for a low-churn move.

Current implementation status:

```text
Deck Explainer
  vagent deck <text-or-markdown>
  vagent deck <audio> --mode summarize --duration 5m
  vagent deck <audio> --mode audio-anchored
  vagent deck synthesize-voice <project-id>
  vagent deck render <project-id>
  vagent deck render <project-id> --html-render-command '["hyperframes"]' --html-render --html-validate
  writes DocumentIR / ContentBlockIR / ClaimsIR / SourceQuotesIR / OutlineIR / DeckIR / SpeakerScriptIR / TimedDeckIR
  writes tts-segments.json, deck-voiceover.json, and audio/deck_voiceover.wav
  top-level deck commands synthesize or preserve audio, compile HTML, write deck-quality-report.json, and write renders/final.mp4
  summarize mode transcribes audio to transcript.json, then generates a new script/TTS deck
  audio-anchored mode writes transcript.json and preserves source audio as deck voiceover
  renders DeckIR to static HTML under renders/html, can hand that HTML project to an external renderer, and still writes final video through an ffmpeg fallback
  generic storyboard/timeline projects still render through the shared HyperFrames boundary

Film Recap
  vagent film <video>
  vagent film ingest <video>
  vagent film understand <project-id>
  vagent film build-story-index <project-id>
  vagent film plan-clips <project-id> --target 10m
  vagent film cut <project-id>
  vagent film narrate <project-id>
  vagent film synthesize-voice <project-id>
  vagent film mix-audio <project-id>
  vagent film subtitle <project-id>
  vagent film render <project-id>
  vagent film quality-check <project-id>
  writes media-info.json, source-manifest.json, scenes.json, frames.json, asr-result.json,
  silence-periods.json, vlm-analysis.json, timeline-fusion.json, story-index.json,
  narrative-beats.json, character-index.json, clip-plan.json, clip-plan-validated.json,
  output-timeline-map.json, output-narration.json, narration.json, tts-segments.json,
  audio/tts/*, audio/audio_mix.wav, audio-mix.json, subtitles.json,
  renders/subtitles.srt, renders/final.mp4, render-output.json, quality-report.json,
  and renders/edited_source.mp4
  keeps aligned source audio in the cut when present and ducks it under TTS in audio_mix.wav
  calls configured ASR/VLM providers during understand-source when source audio/frames are available
```

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
    ffmpeg / ffprobe / process wrappers with Bun subprocess execution

  providers/
    ASR / VLM / TTS plus storyboard/script business provider interfaces

  llm/
    Internal LLMClient interface, AI SDK config factory, and AI SDK-backed default adapter used by LLM-backed providers

  renderer-ffmpeg/
    First runnable renderer that emits renders/final.mp4 from TimelineIR and subtitles from NarrationIR

  renderer-html/
    DeckIR to static HTML slide project compiler boundary

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

## Shared Stage Runtime

The runtime executes stage graphs. Stage outputs must be serializable artifacts so runs can resume from checkpoints. The existing runnable chain is still stage-based:

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
  render through HyperFrames or ffmpeg; slide_explainer storyboards auto-select HyperFrames unless a renderer is explicit

quality
  inspect storyboard source ranges, clip plan consistency, timeline bounds, narration timing, TTS coverage, long-video explainer structure, generated subtitles, rendered media streams/duration, audio loudness, black-frame smoke checks, visual smoke checks

export
  copy final video, HyperFrames render directory, or project bundle to a user-selected path
```

Each stage accepts typed input, writes artifacts, emits events, and returns typed output. The current `JobRunner` runs the initial chain: ingest -> understand -> plan -> script -> voiceover -> quality. CLI runs can resume from a later stage with `run --from-stage` when required artifacts already exist, or with `rerun <projectId> --from-stage` to reuse the input path stored in `job-state.json`. Before resuming, the runtime validates the upstream artifact set for the requested checkpoint and fails without mutating job state when artifacts are missing, changed, untracked by the artifact manifest, or invalid against the relevant IR schema. Runtime adapters can use the project quality aggregate to combine pipeline checks, render diagnostics, and artifact integrity into a single deliverability report.

## Film Recap Pipeline

Film recap is for TV, movie, and long-video editing commentary. Its stage graph is media-first and cut-first:

```text
input video
  -> ingest / probe
  -> source understanding
  -> story index / narrative beats
  -> clip planning
  -> render cut
  -> narrate against cut output
  -> voiceover / subtitles / audio mix
  -> render / export
  -> quality check
```

Important rule: do not write final narration against the original movie timeline and then cut large sections away. The pipeline first writes an evidence-backed `clip-plan.json`, renders `edited_source.mp4`, writes `output_timeline_map.json`, and only then writes narration timestamps against the output timeline.

Primary artifacts:

```text
source-manifest.json
scenes.json
asr-result.json
silence-periods.json
frames/
vlm-analysis.json
timeline-fusion.json
story-index.json
narrative-beats.json
character-index.json
clip-plan.json
edited_source.mp4
clip-plan-validated.json
output-timeline-map.json
output-narration.json
narration.json
voiceover/
tts-segments.json
subtitles.ass
audio_mix.wav
final.mp4
quality_report.json
```

Current `understand-source` behavior is provider-backed: audio sources are extracted to `audio/source_audio.wav`, transcribed through the configured ASR provider, converted into Film ASR segments, and used to derive silence gaps and ASR-aligned scene ranges when timestamps are available. The stage samples one representative frame per scene and sends those scene frame batches to the configured VLM provider before writing `vlm-analysis.json` and `timeline-fusion.json`. Sources without audio or without useful timestamps fall back to coarse duration-based scenes and placeholder/no-audio silence artifacts, but still keep the same Film IR artifact names.

Current `build-story-index` behavior consumes `timeline-fusion.json`, `asr-result.json`, and `vlm-analysis.json`. It prefers evidence text over placeholders, infers narrative beat types such as `decision`, `reversal`, `conflict`, `climax`, and `resolution`, and builds `character-index.json` from VLM character hints plus role names detected in ASR/VLM summaries.

Current `plan-clips` behavior scores beats before cutting: reversal, climax, decision, inciting incident, conflict, resolution, setup, and transition are weighted in that order, then boosted by evidence count, character presence, and plot keywords such as decisions, truth reveals, clues, and showdowns. The selected clips are written back in source chronology so the output remains watchable, while `priorityScore`, `selectionRank`, and `reason` explain why each clip was kept.

Film-specific IR lives in `packages/ir/src/film.ts`: `FilmScene`, `ASRSegment`, `VLMSceneAnalysis`, `StoryIndex`, `NarrativeBeat`, `OutputTimelineMap`, and `OutputNarration`.

Quality checks should focus on source/output timeline consistency, evidence-backed clip choice, narration alignment to the edited output, speech overlap, ducking decisions, subtitle bounds, loudness, and render diagnostics.

Target command shape:

```sh
vagent film input.mp4 --target 10m --platform douyin --style short-drama
vagent film ingest input.mp4
vagent film understand <job-id>
vagent film build-story-index <job-id>
vagent film plan-clips <job-id> --target 10m
vagent film cut <job-id>
vagent film narrate <job-id>
vagent film synthesize-voice <job-id>
vagent film mix-audio <job-id>
vagent film subtitle <job-id>
vagent film render <job-id>
vagent film quality-check <job-id>
```

## Deck Explainer Pipeline

Deck explainer is for text, article, podcast, audio, tutorial, research, product, or meeting material that becomes a PPT-style video. Its stage graph is content-first and deck-first:

```text
text / audio
  -> content ingest
  -> transcript / document normalize
  -> outline planning
  -> deck storyboard
  -> speaker script
  -> timing
  -> HTML slide render
  -> capture / mux
  -> quality check
```

There are two modes:

```text
script-generated
  Input text/audio is summarized and rewritten, then new TTS drives slide timing.

audio-anchored
  Original audio is preserved; ASR timestamps drive chapter segmentation and slide alignment.
```

Primary artifacts:

```text
content_raw.json
transcript.json
document.json
content-blocks.json
claims.json
source-quotes.json
outline.json
deck.json
speaker-script.json
tts-segments.json
timed-deck.json
deck.html
slides_preview/
silent_video.mp4
voiceover.wav
subtitles.ass
final.mp4
deck-quality-report.json
```

Deck-specific IR lives in `packages/ir/src/deck.ts`: `Document`, `ContentBlock`, `Outline`, `Deck`, `Slide`, `SpeakerScript`, `SlideTiming`, and `TimedDeck`.

The primary renderer for this pipeline is HTML/HyperFrames/Chromium, with ffmpeg used for muxing, subtitles, loudness, and final delivery. Remotion can be added later as another renderer that consumes `DeckIR` or `TimelineIR`; it must not own content understanding.

Quality checks should focus on text density, safe area, title overflow, visual hierarchy, contrast, slide/audio timing, subtitle overlap, chart/source evidence, repeated slides, and empty slides. The current `deck-quality-report.json` covers text density, title length, bullet count, slide timing gaps/overlaps, too-short slides, duplicate visible text, and chart-source evidence, and its warnings/errors are included in the project quality aggregate.

Current and target command shape:

```sh
vagent deck article.md --duration 3m --format portrait --style tech
vagent deck podcast.mp3 --mode summarize --duration 5m
vagent deck podcast.mp3 --mode audio-anchored
```

## Long-Video Strategy

Long source videos should use a chunk-first plan instead of sending the whole file through one ASR/VLM/script context. The current runtime already has retries, checkpoint validation, artifact manifests, and stage reruns; long-video work should build on those contracts by making chunk outputs first-class artifacts.

The default long-video planning parameters are:

```text
chunkDuration: 300 seconds
chunkOverlap: 10 seconds
frameSampleFps: 1
vlmFrameSampleFps: 0.2
sceneDetection: true
asrChunking: true
vlmBatchSize: 16
```

The intended hierarchy is:

```text
raw video
  -> chunk-plan.json
  -> frames.json
  -> scene-batches.json
  -> chunk-summaries.json
  -> chapters.json
  -> global-outline.json
  -> selected-moments.json
  -> clip-plan.json
  -> narration.json
  -> timeline.json
```

`chunk-plan.json` divides the source into non-overlapping content ranges plus overlapping analysis ranges, while `frames.json` records extracted analysis frame paths, timestamps, and sampling fps for VLM auditability. Runtime understanding uses analysis ranges for ASR/VLM context, clamps transcript output back to content ranges, writes per-chunk ASR, VLM, silence, and summary evidence under stable artifact prefixes such as `chunks/000`, and checkpoint validation requires those per-chunk artifacts before later-stage reruns. With `sceneDetection: true`, VLM batches are transcript-aligned; with `sceneDetection: false`, understanding sends one full-duration VLM batch and assigns that visual context to overlapping chunks using the batch time range. Chunked ASR reruns reuse valid per-chunk transcript artifacts before calling the ASR provider again, and VLM reruns reuse unchanged scenes by matching each cached scene id, time range, and frame list from `scene-batches.json` before calling the VLM provider for stale scenes only. Planning stages work from chunk and chapter summaries, then select evidence-backed moments for final scripting and rendering. Selected moments are split into PPT-like `slide_explainer` storyboard scenes and page-style narration segments, avoiding a single full-video scene for explainers. The content quality aggregate rechecks current artifacts for too few selected moments, non-slide explainer styles, oversized scenes, and oversized narration segments so stale clean `quality-report.json` artifacts do not mask collapsed explainer output. The current stage boundary is still `understand`; first-class per-chunk stage status can be added without changing the artifact hierarchy.

HyperFrames remains the visual storytelling renderer for page-based explainers and article/podcast-to-video flows. FFmpeg remains the media boundary for probe, extraction, streamcopy clipping, concat, muxing, progress reporting, loudness, subtitles, and final delivery. Remotion can be added later as a second renderer for React composition and chunk/cloud rendering; it should consume storyboard/timeline IR instead of owning understanding logic.

## Current Deck Slice

Text and Markdown inputs can bypass media understanding entirely today. The top-level `deck` command reads the source document, splits it into bounded slide sections, writes DeckIR artifacts (`document.json`, `content-blocks.json`, `claims.json`, `source-quotes.json`, `outline.json`, `deck.json`, `speaker-script.json`, and `timed-deck.json`) plus the existing render artifact family used by media-derived explainers: `media-info.json`, `selected-moments.json`, `storyboard.json`, `timeline.json`, `narration.json`, and `quality-report.json`, then synthesizes voice, updates timing, compiles HTML, writes `deck-quality-report.json`, and writes `renders/final.mp4`. `deck --mode summarize` transcribes audio to `transcript.json`, then treats that transcript as content for a newly generated script/TTS deck. `deck synthesize-voice` remains available as a staged rerun command; it runs TTS from `speaker-script.json`, writes `tts-segments.json`, `deck-voiceover.json`, and `audio/deck_voiceover.wav`, and updates `timed-deck.json`, `timeline.json`, and `narration.json` to the real audio durations. Audio-anchored deck mode runs ASR, writes `transcript.json`, converts the source audio to `audio/deck_voiceover.wav`, and aligns slide timings to ASR timestamps or fixed windows when timestamps are unavailable before rendering. `deck render` calls `packages/renderer-html` to compile `TimedDeckIR` into `renders/html/index.html`, `styles.css`, `runtime.js`, and `deck-render-plan.json`; with `--html-render`, it passes that HTML project to an external renderer command such as HyperFrames and stores the validation/render command results in `render-output.json`. It also creates simple slide frames from DeckIR, renders `renders/deck_silent.mp4`, muxes `audio/deck_voiceover.wav`, and writes `renders/final.mp4` for stable local delivery. These projects use `slide_explainer` visual style from the start, so the generic `render` command can still auto-select HyperFrames and export an HTML directory unless the Deck-specific final render has been run.

This is the early runnable slice of the Deck Explainer Pipeline. The remaining renderer migration is to make Chromium/HyperFrames capture from `renders/html/` the primary final-video path once that external renderer is available, with the current ffmpeg frame fallback kept for deterministic local operation.

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

LongVideoChunkPlan
  source duration, chunk defaults, non-overlapping content ranges, overlapping analysis ranges

LongVideoChunkSummary / LongVideoChunkSilence / LongVideoChapterSummary / LongVideoGlobalOutline / LongVideoSelectedMoments
  per-chunk summaries, silence ranges, hierarchical summaries, and evidence-backed selections for long-video planning

Film Recap IR
  SceneIR, ASRSegmentIR, VLMSceneIR, StoryIndexIR, NarrativeBeatIR, OutputTimelineMapIR, OutputNarrationIR

Deck Explainer IR
  DocumentIR, ContentBlockIR, ClaimsIR, SourceQuotesIR, OutlineIR, DeckIR, SlideIR, SpeakerScriptIR, SlideTimingIR
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

Concrete providers can wrap local command adapters, deterministic fallback logic, `@video-agent/llm`, or provider-specific media-producing endpoints. Runtime stages call business provider interfaces only; they do not call AI SDK or vendor SDKs directly. If workspace config contains an `llm` block, runtime creates an AI SDK-backed `LLMClient` and injects it into ASR/VLM/storyboard/script providers that select `llm`; TTS providers may also receive a project audio output directory so they can write real voiceover files. Hosted LLM-like services should be added through `packages/llm` provider config and AI SDK transforms when possible; binary media endpoints such as MiMo TTS stay behind provider interfaces when they need to write artifacts directly. Local model inference should still be isolated behind the same provider contracts.

## Near-Term Roadmap

1. Keep hosted ASR/VLM model endpoints on the shared AI SDK-backed `LLMClient` path, adding provider-specific transforms only inside `packages/llm`; keep binary TTS output behind the `TTSProvider` artifact boundary.
2. Validate MCP config output against named external clients and document placement, env injection, config shape, command mode, limitations, and verification dates in a client matrix.
3. Add named providers only for non-LLM/local execution boundaries that cannot fit the shared AI SDK path.
4. Replace the dependency-free TUI guided selector with richer Ink/Clack interactions after the dependency policy is accepted.

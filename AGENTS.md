# AGENTS.md

This file gives repository-specific guidance for AI coding agents working in `video-agent`.

## Project Intent

`video-agent` is a Bun-first TypeScript video agent framework. Keep the core headless and adapter-agnostic:

```text
Core/runtime packages own workflow behavior.
CLI/TUI/MCP/API/Web adapters only call core/runtime APIs.
Media processing is delegated to ffmpeg, ffprobe, Chromium, and HyperFrames.
```

Do not turn this repository into a Claude Code-only plugin or a UI-first application. Claude Code skills, MCP, TUI, API, and Web Studio are adapters over the same core runtime.

## Runtime And Package Manager

- Use Bun for package management and local scripts.
- Keep `bun.lock` updated when dependencies or workspace packages change.
- Do not add `pnpm-lock.yaml`, `package-lock.json`, or `yarn.lock`.
- Prefer Bun APIs where they reduce complexity. Alternate JavaScript runtimes are not a design target.

Common commands:

```sh
bun install
bun run build
bun run test
bun run lint
bun run dev hello world
```

## Architecture Rules

- Put shared types and schemas in `packages/ir`.
- Put pipeline orchestration contracts in `packages/core`.
- Put workspace, artifact, event, and job runtime code in `packages/runtime`.
- Put subprocess and media binary wrappers in `packages/media`.
- Put provider interfaces in `packages/providers`.
- Put renderer-specific compilation boundaries in renderer packages, starting with `packages/renderer-ffmpeg` and `packages/renderer-hyperframes`.
- Put validation and inspection logic in `packages/quality`.
- Put persistence contracts and later Drizzle schema in `packages/db`.
- When making intentional architecture changes, do not preserve backward compatibility by default. Remove obsolete APIs, compatibility facades, redundant files, and legacy code paths instead of layering new abstractions on top of old ones. Keep architecture simple, explicit, and forward-looking.

Adapters should not directly call `ffmpeg`, mutate workspace files, or own provider-specific workflow decisions. Route those through package APIs.

## TypeScript Standards

- Keep all package source in TypeScript.
- Use Zod for externally produced or agent-produced JSON IR.
- Export package APIs from `src/index.ts`.
- Use explicit package boundaries instead of deep imports between packages.
- Keep stage inputs and outputs serializable so runs can resume from artifact checkpoints.

## Media Boundary

Do not implement media codecs, muxing, audio mixing, ASR, or VLM inference in TypeScript.

Use TypeScript to orchestrate:

```text
ffmpeg / ffprobe
Chromium / Playwright
HyperFrames CLI
remote provider APIs
local provider services or binaries
```

## LLM Semantic Intelligence

- Do not add keyword lists, regex matching, n-gram overlap scoring, hard-coded semantic labels, fixed position heuristics, rule-based scoring, template narration, or deterministic text splitting for semantic understanding or generation.
- Film Recap, Deck Explainer, and the initial explainer pipeline must get scene semantics, story/chapter summaries, selected moments, storyboard content, slide/deck content, narration/script content, narrative beat types, character relationships, and semantic clip selection from LLM/VLM structured outputs validated by Zod schemas.
- TypeScript runtime code may still orchestrate deterministic media, evidence, and timeline operations such as ffmpeg scene-change detection, silence boundaries, transcript/sourceRange clipping, sourceRange validation, duration clamping, artifact schema validation, provider-call tracing, and render/audio filter construction.
- If no LLM is configured for semantic understanding or generation, fail clearly instead of falling back to rule-based logic, text matching, deterministic semantic templates, or placeholder generation.

## Current CLI State

The root oclif CLI is the first adapter and should continue to call shared runtime APIs rather than duplicating workflow logic. Keep commands focused on local operation and automation-friendly JSON output. Current command areas include:

```text
init
doctor
config
provider-env / provider-test
run
inspect
render
export
status / projects / events / artifacts / quality / visual
rerun / worker
tui / serve / mcp
```

Do not move the CLI into `apps/cli` until the package APIs are stable enough to avoid churn.

## Documentation

- Keep [README.md](./README.md) focused on developer onboarding and current project status.
- Keep [docs/architecture.md](./docs/architecture.md) focused on architecture decisions and package boundaries.
- Update both when adding a new adapter, package, runtime dependency, or pipeline stage.

## Verification

Before finishing a change, run:

```sh
bun run build
bun run test
```

`bun run test` also runs lint through `posttest`.

If a command cannot run because of missing external binaries such as `ffmpeg`, document that clearly in the final response.

## Git And Generated Files

- Do not commit `dist/`, `packages/*/dist/`, `node_modules/`, or `*.tsbuildinfo`.
- Do not revert user changes unless explicitly asked.
- This environment may not expose a valid `.git` directory; do not rely on `git status` as the only way to inspect changes.

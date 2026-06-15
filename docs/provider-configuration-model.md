# Provider Configuration Model

`video-agent` keeps the runtime provider contract stable while real services are added incrementally. The persisted workspace config stays small and describes intent first:

```json
{
  "providerProfile": "mimo",
  "version": 1
}
```

## Decision

Provider selection remains role-based and string-valued for v0:

- `mock` is the deterministic local development provider.
- `command` runs an external JSON stdin/stdout adapter.
- `http` calls a hosted or local JSON HTTP adapter.

Provider profiles prefill non-secret configuration for a hosted service while still using those provider names. The first profile is `mimo`, which selects `http` for ASR, VLM, and TTS, provides endpoint/model/timeout defaults through structured `providerSettings`, and enables the AI SDK-backed LLM planner/script path with `mimo-v2.5-pro`.

Named hosted-service providers should be added only after a target service is selected and a single vertical slice proves the request/response mapping. A named provider must still implement the existing `ASRProvider`, `VLMProvider`, or `TTSProvider` contract and must not require pipeline changes.

## Environment Contract

The shared provider descriptor in `packages/providers/src/descriptors.ts` is the source of truth for built-in provider names, role order, environment variables, placeholders, and secret classification.

Current generic provider env names are:

```text
VIDEO_AGENT_ASR_COMMAND
VIDEO_AGENT_VLM_COMMAND
VIDEO_AGENT_TTS_COMMAND

VIDEO_AGENT_ASR_URL
VIDEO_AGENT_ASR_TOKEN
VIDEO_AGENT_ASR_HEADERS
VIDEO_AGENT_ASR_MODEL
VIDEO_AGENT_ASR_TIMEOUT_MS

VIDEO_AGENT_VLM_URL
VIDEO_AGENT_VLM_TOKEN
VIDEO_AGENT_VLM_HEADERS
VIDEO_AGENT_VLM_MODEL
VIDEO_AGENT_VLM_TIMEOUT_MS

VIDEO_AGENT_TTS_URL
VIDEO_AGENT_TTS_TOKEN
VIDEO_AGENT_TTS_HEADERS
VIDEO_AGENT_TTS_MODEL
VIDEO_AGENT_TTS_TIMEOUT_MS
```

`provider-env`, `doctor`, provider registry setup, shell templates, and future named providers should read from the shared descriptor instead of copying env-name rules.

The simplified LLM path is resolved from the active profile or from explicit runtime config:

```json
{
  "llm": {
    "provider": "anthropic",
    "baseURL": "https://token-plan-cn.xiaomimimo.com/anthropic",
    "model": "mimo-v2.5-pro",
    "authTokenEnv": "VIDEO_AGENT_LLM_TOKEN",
    "name": "mimo"
  }
}
```

When `llm` is present, the `plan` and `script` stages use `@video-agent/llm`, which currently wraps the latest Vercel AI SDK. When it is absent, those stages use deterministic local fallbacks.

## Mimo Profile

Apply the Mimo defaults with:

```sh
bun run dev config --provider-profile mimo --workspace .video-agent
```

The profile writes only the selected profile to disk:

```json
{
  "providerProfile": "mimo",
  "version": 1
}
```

At runtime that resolves to `http` ASR/VLM/TTS providers, Mimo endpoint/model/timeout settings, and the Mimo LLM config. `GET /config` and `config --json` return the resolved non-secret view.

The full known Mimo model catalog captured by the profile is:

```text
mimo-v2.5-pro
mimo-v2.5
mimo-v2.5-asr
mimo-v2.5-tts-voiceclone
mimo-v2.5-tts-voicedesign
mimo-v2.5-tts
mimo-v2-pro
mimo-v2-omni
mimo-v2-tts
```

The profile does not write tokens or custom headers. Configure credentials through the existing non-persistent env path, for example:

```sh
export VIDEO_AGENT_ASR_TOKEN='<token>'
export VIDEO_AGENT_VLM_TOKEN='<token>'
export VIDEO_AGENT_TTS_TOKEN='<token>'
export VIDEO_AGENT_LLM_TOKEN='<token>'
```

## Adding A Named Provider

When a hosted provider is selected:

1. Add a provider descriptor with explicit env requirements, placeholders, and secret flags.
2. Add the provider implementation behind the existing role contract.
3. Register the provider in `createAsrProvider`, `createVlmProvider`, or `createTtsProvider` without changing pipeline code.
4. Add `provider-env`, `provider-test`, and doctor coverage for required and optional env.
5. Add injected-fetch or command-shim tests that validate request shape, response parsing, metadata, and failures without network access.
6. Document any model, endpoint, timeout, or credential behavior without printing secret values.

Keep persisted config concise: defaults are omitted, profile defaults stay in code, and only user overrides are written to `config.json`.

# Provider Configuration Model

`video-agent` keeps the runtime provider contract stable while real services are added incrementally. The current configuration model intentionally keeps existing workspaces compatible:

```json
{
  "providers": {
    "asr": "mock",
    "vlm": "mock",
    "tts": "mock"
  }
}
```

## Decision

Provider selection remains role-based and string-valued for v0:

- `mock` is the deterministic local development provider.
- `command` runs an external JSON stdin/stdout adapter.
- `http` calls a hosted or local JSON HTTP adapter.

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
VIDEO_AGENT_ASR_TIMEOUT_MS

VIDEO_AGENT_VLM_URL
VIDEO_AGENT_VLM_TOKEN
VIDEO_AGENT_VLM_HEADERS
VIDEO_AGENT_VLM_TIMEOUT_MS

VIDEO_AGENT_TTS_URL
VIDEO_AGENT_TTS_TOKEN
VIDEO_AGENT_TTS_HEADERS
VIDEO_AGENT_TTS_TIMEOUT_MS
```

`provider-env`, `doctor`, provider registry setup, shell templates, and future named providers should read from the shared descriptor instead of copying env-name rules.

## Adding A Named Provider

When a hosted provider is selected:

1. Add a provider descriptor with explicit env requirements, placeholders, and secret flags.
2. Add the provider implementation behind the existing role contract.
3. Register the provider in `createAsrProvider`, `createVlmProvider`, or `createTtsProvider` without changing pipeline code.
4. Add `provider-env`, `provider-test`, and doctor coverage for required and optional env.
5. Add injected-fetch or command-shim tests that validate request shape, response parsing, metadata, and failures without network access.
6. Document any model, endpoint, timeout, or credential behavior without printing secret values.

Existing `mock`, `command`, and `http` configs must continue to load without migration.

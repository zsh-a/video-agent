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
- `llm` uses the configured shared `LLMClient`.

Provider profiles prefill non-secret LLM configuration for a hosted service while still using those provider names. The first profile is `mimo`, which selects `llm` for ASR, VLM, and TTS and enables the AI SDK-backed planner/script path with `mimo-v2.5-pro`. MiMo ASR uses the same token but a role-specific AI SDK OpenAI-compatible model config for `mimo-v2.5-asr`.

Hosted LLM-like services should be integrated through `packages/llm` and the Vercel AI SDK first. Provider-specific request shape differences belong in the AI SDK config boundary, for example `transformRequestBody`; ASR/VLM/TTS providers should continue to call the internal `LLMClient`. Add named providers only for boundaries that are not a good fit for AI SDK, such as local command services or non-LLM executors.

## Environment Contract

The shared provider descriptor in `packages/providers/src/descriptors.ts` is the source of truth for built-in provider names, role order, environment variables, placeholders, and secret classification.

Current generic provider env names are:

```text
VIDEO_AGENT_ASR_COMMAND
VIDEO_AGENT_VLM_COMMAND
VIDEO_AGENT_TTS_COMMAND
```

`provider-env`, `doctor`, provider registry setup, shell templates, and future named providers should read from the shared descriptor instead of copying env-name rules.

The simplified LLM path is resolved from the active profile or from explicit runtime config:

```json
{
  "llm": {
    "provider": "anthropic",
    "baseURL": "https://token-plan-cn.xiaomimimo.com/anthropic/v1",
    "model": "mimo-v2.5-pro",
    "authTokenEnv": "VIDEO_AGENT_LLM_TOKEN",
    "name": "mimo"
  }
}
```

When `llm` is present, ASR/VLM/TTS plus `plan` and `script` can use `@video-agent/llm`, which currently wraps the latest Vercel AI SDK. When it is absent, planning uses deterministic local fallbacks and media roles must use `mock` or `command`.

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

At runtime that resolves to `llm` ASR/VLM/TTS providers and the Mimo LLM config. `GET /config` and `config --json` return the resolved non-secret view.

The profile keeps one active LLM model:

```text
mimo-v2.5-pro
```

The profile does not write tokens. Configure credentials through `.env` or the shell:

```dotenv
VIDEO_AGENT_LLM_TOKEN=<token>
```

The runtime reads `.env` from the current working directory and from the workspace directory. Values from the workspace `.env` override the current working directory `.env`; real process environment variables override both. Explicit `--env KEY=VALUE` flags and API/MCP `env` objects bypass `.env` and use only the supplied values.

## Adding A Named Provider

When a new hosted model endpoint is selected:

1. Prefer adding or extending an AI SDK provider config in `packages/llm`.
2. Keep credentials on the shared LLM env path, normally `VIDEO_AGENT_LLM_TOKEN`.
3. Keep ASR/VLM/TTS implementations behind the internal `LLMClient`; do not add a generic HTTP provider path.
4. Use AI SDK request-body transforms only for provider-specific protocol differences.
5. Add `provider-test`, doctor, and no-network tests that validate request shape, response parsing, metadata, and failures.
6. Document model, endpoint, and credential behavior without printing secret values.

Add a named provider descriptor only when the service cannot reasonably be represented through the AI SDK-backed LLM boundary.

Keep persisted config concise: defaults are omitted, profile defaults stay in code, and only user overrides are written to `config.json`.

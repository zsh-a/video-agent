# Provider Configuration Model

`video-agent` keeps the runtime provider contract stable while real services are added incrementally. The persisted workspace config stays small and describes intent first:

```json
{
  "providerProfile": "mimo",
  "version": 1
}
```

## Decision

Provider selection remains role-based and uses the built-in provider-name union:

- `mock` is the fixed-output local development provider for media roles.
- `command` runs an external JSON stdin/stdout adapter.
- `llm` uses the configured shared `LLMClient`.

Provider profiles prefill non-secret LLM configuration for a hosted service while still using those provider names. The first profile is `mimo`, which selects `llm` for ASR, VLM, and TTS and enables the AI SDK-backed planner/script path with the profile LLM model. MiMo ASR uses the same token but a role-specific AI SDK OpenAI-compatible model config. MiMo TTS uses the MiMo chat-completions audio API to write real wav files into the project workspace before render. MiMo model IDs are centralized in `MIMO_PROVIDER_MODEL_IDS` in `packages/providers/src/profiles.ts`.

Runtime config normalization validates provider names, provider profiles, provider settings roles and fields, and persistence backends before any pipeline stage creates providers or job stores. Unknown values fail at `readConfig`/`doctor` time instead of being silently treated as defaults or surfacing later in a provider factory.

Hosted LLM-like services should be integrated through `packages/llm` and the Vercel AI SDK first. Provider-specific request shape differences belong in the AI SDK config boundary, for example `transformRequestBody`. Media-producing endpoints may stay behind provider interfaces when the SDK boundary cannot return required binary artifacts cleanly, as with MiMo TTS wav output. Add named providers only for boundaries that are not a good fit for AI SDK, such as local command services or non-LLM executors.

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
    "provider": "openai-compatible",
    "baseURL": "https://token-plan-cn.xiaomimimo.com/v1",
    "model": "mimo-v2.5",
    "apiKeyEnv": "VIDEO_AGENT_LLM_TOKEN",
    "name": "mimo",
    "supportsStructuredOutputs": true
  }
}
```

When `llm` is present, ASR/VLM/TTS plus planning and script stages can use `@video-agent/llm`, which currently wraps the latest Vercel AI SDK. Semantic understanding and generation require LLM/VLM structured outputs across Film Recap and Deck Explainer. When `llm` is absent, semantic stages fail clearly instead of using deterministic text-matching fallbacks, template generation, or local rule-based planning. Media roles must use `mock` or `command` when no hosted provider is configured.

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

At runtime that resolves to `llm` ASR/VLM/TTS providers and the Mimo LLM config. The profile sets `supportsStructuredOutputs: true` so AI SDK object generation sends an OpenAI-compatible JSON schema response format instead of downgrading schema requests to generic JSON object mode. `GET /config` and `config --json` return the resolved non-secret view. For TTS, the registry detects the Mimo profile and calls `mimo-v2.5-tts` through the chat-completions audio endpoint, writing wav files under `audio/tts/` and returning those paths in `tts-segments.json`.

All MiMo models in the profile use the same base URL, `https://token-plan-cn.xiaomimimo.com/v1`, and the same key resolution order.

The profile keeps one active default model for each MiMo role:

```text
llm: mimo-v2.5
asr: mimo-v2.5-asr
tts: mimo-v2.5-tts
```

The profile does not write tokens. Configure credentials through `.env` or the shell:

```dotenv
VIDEO_AGENT_LLM_TOKEN=<token>
```

The whole MiMo profile also accepts the documentation-style key name:

```dotenv
MIMO_API_KEY=<token>
```

Optional TTS controls can be provided through environment variables:

```dotenv
VIDEO_AGENT_TTS_MIMO_VOICE=mimo_default
VIDEO_AGENT_TTS_MIMO_STYLE=清晰自然地播报
VIDEO_AGENT_TTS_MIMO_MODEL=mimo-v2.5-tts
```

MiMo ASR must return transcript JSON with explicit timed segments and `timestampConfidence: "exact"`. Runtime passes media duration into the ASR provider only to validate returned timestamps against the requested audio window; it does not convert plain text into synthetic source-backed timestamps. Longer audio is still cut into 30 second wav windows with ffmpeg, but each window response must provide exact timestamps relative to that window.

The runtime reads `.env` from the current working directory and from the workspace directory. Values from the workspace `.env` override the current working directory `.env`; real process environment variables override both. Explicit `--env KEY=VALUE` flags and API/MCP `env` objects bypass `.env` and use only the supplied values.

## Adding A Named Provider

When a new hosted model endpoint is selected:

1. Prefer adding or extending an AI SDK provider config in `packages/llm`.
2. Keep credentials on the shared LLM env path, normally `VIDEO_AGENT_LLM_TOKEN`.
3. Keep ASR/VLM/TTS implementations behind the internal `LLMClient` unless the endpoint needs to produce binary media artifacts directly.
4. Use AI SDK request-body transforms only for provider-specific protocol differences.
5. Add `provider-test`, doctor, and no-network tests that validate request shape, response parsing, usage/cost metadata, retryable failure reporting, LLM trace summaries, and failures.
6. Document model, endpoint, and credential behavior without printing secret values.

Add a named provider descriptor only when the service cannot reasonably be represented through the AI SDK-backed LLM boundary.

Keep persisted config concise: defaults are omitted, profile defaults stay in code, and only user overrides are written to `config.json`.

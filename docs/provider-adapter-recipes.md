# Provider Adapter Recipes

`video-agent` intentionally keeps provider integrations behind JSON contracts. The runtime can call either:

- `command` providers through `VIDEO_AGENT_ASR_COMMAND`, `VIDEO_AGENT_VLM_COMMAND`, and `VIDEO_AGENT_TTS_COMMAND`
- `llm` providers through the shared `llm` config, for example the `mimo` profile

Provider-specific adapter work is isolated to a command process. Hosted model access should use the shared LLM path unless a concrete service needs a dedicated provider.

## Command Adapter Smoke Test

The repository includes a runnable command adapter example:

```sh
bun examples/provider-adapters/mock-json-provider.ts
```

It reads one JSON payload from stdin and writes one JSON response envelope to stdout. Use it to validate the command-provider path before replacing the implementation with real service calls:

```sh
bun run dev config --asr command --vlm command --tts command --workspace .video-agent
bun run dev provider-env --shell-template --workspace .video-agent
export VIDEO_AGENT_ASR_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
export VIDEO_AGENT_VLM_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
export VIDEO_AGENT_TTS_COMMAND='["bun","examples/provider-adapters/mock-json-provider.ts"]'
bun run dev provider-env --json --workspace .video-agent
bun run dev provider-test --workspace .video-agent
```

When the env values are set, `provider-env` should report each required command variable as configured. `provider-test` should call each adapter with a minimal ASR/VLM/TTS payload and report `succeeded` for each role before you run the full pipeline. Command adapters can return an optional `metadata` envelope with `model`, `requestId`, `usage`, and `cost`; `provider-test` includes those fields in the certification output and records structured setup, validation, and execution failures.

## LLM Provider Smoke Test

Use the Mimo profile when ASR/VLM/TTS should all go through the shared LLM chain:

```sh
bun run dev config --provider-profile mimo --workspace .video-agent
printf 'VIDEO_AGENT_LLM_TOKEN=<token>\n' > .env
bun run dev doctor --workspace .video-agent
```

`provider-env` has no role-specific variables for `llm`; `doctor` validates that the shared LLM config and token env are present.

## Payloads

ASR command payload:

```json
{
  "kind": "asr",
  "version": 1,
  "input": {
    "path": "/path/to/audio.wav",
    "mimeType": "audio/wav"
  }
}
```

VLM command payload:

```json
{
  "kind": "vlm",
  "version": 1,
  "context": "optional planning context",
  "input": [
    {
      "sceneId": "scene-1",
      "timeRange": [0, 3],
      "frames": ["/path/to/frame.jpg"]
    }
  ]
}
```

TTS command payload:

```json
{
  "kind": "tts",
  "version": 1,
  "segments": [
    {
      "id": "narration-1",
      "start": 0,
      "duration": 2,
      "text": "Narration text"
    }
  ]
}
```

## Response Envelope

Providers may return raw data, but real adapters should prefer an envelope so request id, model, usage, and cost metadata are preserved in `provider-calls.jsonl`:

```json
{
  "data": {
    "text": "transcript text",
    "segments": [
      {
        "start": 0,
        "end": 1,
        "text": "transcript text"
      }
    ]
  },
  "metadata": {
    "requestId": "provider-request-id",
    "model": "provider-model",
    "usage": {
      "audioSeconds": 1
    },
    "cost": {
      "amount": 0.01,
      "currency": "USD",
      "estimated": true
    }
  }
}
```

VLM `data` must be an array of `{sceneId, description, evidence}` objects. TTS `data` must be an array of `{narrationId, path, duration}` objects. The TTS `path` should point to an audio file written by the adapter, relative to the project directory or as an absolute path.

## Local Command Adapter Checklist

When replacing the mock recipe with a local process or command-wrapped service:

- prefer the shared AI SDK-backed `llm` provider for hosted LLM-like services
- keep the command process stateless
- translate provider-specific request/response shapes at the adapter boundary
- write TTS audio files before returning their paths
- return envelope metadata with request id, model, usage, and estimated cost when available
- do not print tokens or provider responses containing secrets to stderr/stdout logs
- run `bun run dev provider-env --json --workspace .video-agent` before a full pipeline run
- run `bun run dev provider-env --shell-template --workspace .video-agent` to generate non-secret `export` placeholders for the current provider selection
- run `bun run dev provider-env --env KEY=VALUE --json --workspace .video-agent` when an agent client should validate only explicit environment values
- run `bun run dev provider-test --workspace .video-agent` to validate adapter response contracts before a full pipeline run
- run `bun run dev provider-test --env KEY=VALUE --workspace .video-agent` when an agent client should smoke-test only explicit environment values
- use `GET /provider-env?env=KEY=VALUE`, `POST /provider-test` with an `env` object, or MCP provider tools with an `env` object for the same explicit-value checks from API/agent clients
- run `bun run test` after changing in-repo adapter code

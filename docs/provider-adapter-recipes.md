# Provider Adapter Recipes

`video-agent` intentionally keeps provider integrations behind JSON contracts. The runtime can call either:

- `command` providers through `VIDEO_AGENT_ASR_COMMAND`, `VIDEO_AGENT_VLM_COMMAND`, and `VIDEO_AGENT_TTS_COMMAND`
- `http` providers through `VIDEO_AGENT_ASR_URL`, `VIDEO_AGENT_VLM_URL`, and `VIDEO_AGENT_TTS_URL`

The provider-specific work is therefore isolated to an adapter process or HTTP endpoint. That adapter can call a hosted ASR/VLM/TTS service, a local model server, or a mock during development.

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

When the env values are set, `provider-env` should report each required command variable as configured. `provider-test` should call each adapter with a minimal ASR/VLM/TTS payload and report `succeeded` for each role before you run the full pipeline.

## HTTP Adapter Smoke Test

The repository also includes a runnable HTTP adapter example:

```sh
PORT=4318 bun examples/provider-adapters/mock-http-provider.ts
```

It accepts ASR, VLM, and TTS payloads on the same `POST` endpoint and returns the same response envelope shape as the command adapter. Use it to validate the HTTP-provider path:

```sh
bun run dev config --asr http --vlm http --tts http --workspace .video-agent
bun run dev provider-env --shell-template --workspace .video-agent
export VIDEO_AGENT_ASR_URL='http://127.0.0.1:4318'
export VIDEO_AGENT_VLM_URL='http://127.0.0.1:4318'
export VIDEO_AGENT_TTS_URL='http://127.0.0.1:4318'
bun run dev provider-env --json --workspace .video-agent
bun run dev provider-test --workspace .video-agent
```

When the env values are set, `provider-env` should report each required URL variable as configured. `provider-test` should call each endpoint with a minimal ASR/VLM/TTS payload and report `succeeded` for each role. The mock server echoes the `x-video-agent-request-id` header in `metadata.requestId`, which makes it useful for checking provider-call tracing before wiring a hosted service.

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

## HTTP Adapter Notes

HTTP providers receive the same payloads with `POST` and `content-type: application/json`. The runtime also sends:

- `x-video-agent-kind`
- `x-video-agent-version`
- `x-video-agent-request-id`

If the HTTP response omits `metadata.requestId`, the runtime records the generated request id. Optional bearer tokens and timeouts are configured with:

```sh
VIDEO_AGENT_ASR_TOKEN
VIDEO_AGENT_ASR_TIMEOUT_MS
VIDEO_AGENT_VLM_TOKEN
VIDEO_AGENT_VLM_TIMEOUT_MS
VIDEO_AGENT_TTS_TOKEN
VIDEO_AGENT_TTS_TIMEOUT_MS
```

## Real Service Adapter Checklist

When replacing the mock recipe with a real hosted service:

- keep the process or HTTP endpoint stateless
- translate provider-specific request/response shapes at the adapter boundary
- write TTS audio files before returning their paths
- return envelope metadata with request id, model, usage, and estimated cost when available
- do not print tokens or provider responses containing secrets to stderr/stdout logs
- run `bun run dev provider-env --json --workspace .video-agent` before a full pipeline run
- run `bun run dev provider-env --shell-template --workspace .video-agent` to generate non-secret `export` placeholders for the current provider selection
- run `bun run dev provider-test --workspace .video-agent` to validate adapter response contracts before a full pipeline run
- run `bun run test` after changing in-repo adapter code

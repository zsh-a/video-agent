# Deck Golden Cases

This directory defines the first external-sample golden cases for the Deck Explainer pipeline.

The case manifest is intentionally small and source-based:

- `cases.json` is the machine-readable source of truth.
- `fixtures/` is generated locally and ignored by git.
- Large audio corpora are not downloaded or committed automatically.
- Every materialized fixture must keep source, license, and attribution metadata.

## Materialize Direct Fixtures

Direct fixtures are Markdown files and small Open Speech Repository WAV files.

```sh
bun examples/golden-cases/fetch-fixtures.ts
```

The script writes:

```text
examples/golden-cases/fixtures/<case-id>/input.md
examples/golden-cases/fixtures/<case-id>/input.wav
examples/golden-cases/fixtures/<case-id>/case.json
```

Cases with `fixturePolicy: "manual-excerpt"` are skipped because they reference large corpora.

## Manual Audio Fixtures

For `audio-librispeech-dev-clean`, download LibriSpeech `dev-clean` from OpenSLR, choose a 60-120 second excerpt with its transcript, convert it to `input.wav`, and keep transcript/source notes in the same fixture directory.

For `audio-harper-valley-dialog`, use one HarperValleyBank call, mix the agent and caller channels into a short mono WAV, and keep the transcript JSON next to the fixture.

Do not commit generated media files.

## Run A Case

After materializing a fixture, run the command embedded in the case:

```sh
bun run dev deck examples/golden-cases/fixtures/md-k8s-pods-en/input.md --duration 3m --language en-US --project-id golden-md-k8s-pods-en
bun run dev deck synthesize-voice golden-md-k8s-pods-en
bun run dev deck render golden-md-k8s-pods-en
bun run dev quality-check golden-md-k8s-pods-en
bun run dev provider-report golden-md-k8s-pods-en
```

Use the `expected` block in `cases.json` as the review checklist. It is not a replacement for visual review; it records the minimum contract each sample should satisfy before it becomes a CI or nightly regression case.

## Run With The Golden Runner

Use dry-run mode to check selection and report writing without requiring fixtures or providers:

```sh
bun examples/golden-cases/run-cases.ts --dry-run --case md-k8s-pods-en
```

Run plan-only generation when you want DeckIR and quality artifacts without voice synthesis or final rendering:

```sh
bun examples/golden-cases/run-cases.ts --case md-k8s-pods-en --skip-render --trace
```

Run full rendering for one or more cases:

```sh
bun examples/golden-cases/run-cases.ts --case md-k8s-pods-en,md-github-rest-api --renderer remotion --trace
```

Reports are written under `examples/golden-cases/runs/<timestamp>/report.json` by default and include case status, project id, fixture path, source attribution, quality summary, provider report, and render output path when available.

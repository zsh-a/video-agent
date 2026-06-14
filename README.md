# video-agent

`video-agent` 是一个 Bun-first、TypeScript-first 的视频 Agent 框架。目标是用 TypeScript 统一业务编排、IR、Provider、CLI/API/TUI/MCP 入口，同时把媒体内核交给 `ffmpeg`、`ffprobe`、Chromium、HyperFrames 这类外部执行器。

当前仓库处于基础框架阶段：保留 oclif CLI 作为第一阶段命令入口，同时已经拆出 core/runtime/IR/media/provider/renderer/quality/db 等 workspace package。

## 设计边界

```text
TypeScript:
  pipeline 编排、IR schema、Provider contract、API、CLI、TUI、MCP、状态管理

外部二进制:
  ffmpeg、ffprobe、Chromium、HyperFrames CLI

不做:
  用纯 TypeScript 自研视频编码、音频混音、ASR/VLM 推理内核
```

更完整的架构说明见 [docs/architecture.md](./docs/architecture.md)，初版落地计划见 [docs/implementation-plan.md](./docs/implementation-plan.md)。

## 技术栈

```text
Runtime:        Bun-first，保留 Node fallback
Package:        Bun workspaces
CLI:            oclif
Schema / IR:    Zod
Media:          ffmpeg / ffprobe wrapper
Renderer:       HyperFrames boundary
Runtime:        artifact store + event bus + resumable stage contracts
Future UI:      CLI / TUI / MCP / API / Web Studio adapters
```

## 目录结构

```text
bin/
  dev.js                  # Bun 开发入口
  run.js                  # 发布后的 CLI 入口

src/
  commands/               # 当前 oclif 命令入口，后续替换 hello demo

packages/
  ir/                     # Zod schemas: timeline/storyboard/narration/job/artifact
  core/                   # Stage、PipelineContext、runPipeline
  runtime/                # artifact store、event bus、job runtime 边界
  api/                    # Fetch API handler for runtime state
  mcp/                    # MCP stdio adapter for agent tools
  media/                  # ffmpeg / ffprobe / process wrapper
  providers/              # ASR / VLM / TTS provider interfaces
  renderer-ffmpeg/        # 第一版 ffmpeg renderer，输出 final.mp4
  renderer-hyperframes/   # HyperFrames render plan boundary
  quality/                # timeline/artifact quality checks
  db/                     # persistence record contracts

docs/
  architecture.md         # 架构文档
```

## 本地开发

需要安装 Bun。

```sh
bun install
bun run build
bun run test
```

运行当前开发 CLI：

```sh
bun run dev init
bun run dev doctor
bun run dev config --json
bun run dev config --interactive
bun run dev config --asr command --vlm command --tts command
bun run dev provider-env
bun run dev provider-env --json
bun run dev config --job-store sqlite
bun run dev config --max-stage-retries 2 --retry-backoff-ms 500
bun run dev inspect ./input.mp4
bun run dev run ./input.mp4
bun run dev artifacts <projectId>
bun run dev artifacts <projectId> media-info.json
bun run dev artifacts <projectId> --verify
bun run dev events <projectId>
bun run dev events <projectId> --kind provider --status failed
bun run dev projects
bun run dev quality <projectId>
bun run dev quality <projectId> --details --json
bun run dev visual <projectId>
bun run dev visual <projectId> --json --include-content
bun run dev run ./input.mp4 --project-id <projectId> --from-stage plan
bun run dev rerun <projectId> --from-stage voiceover
bun run dev status <projectId>
bun run dev worker --dry-run
bun run dev worker --status failed --limit 1
bun run dev worker --dry-run --max-attempts 3
bun run dev tui
bun run dev tui --project <projectId> --watch
bun run dev tui --project <projectId> --action artifact --artifact quality-report.json
bun run dev tui --project <projectId> --action rerun --from-stage script
bun run dev tui --action worker --dry-run --status running
bun run dev serve --workspace .video-agent --port 4317
bun run dev mcp --workspace .video-agent
bun run dev mcp --print-config
bun run dev mcp --print-config --config-mode installed
bun run dev render <projectId>
bun run dev render <projectId> --inspect-audio
bun run dev render <projectId> --no-audio
bun run dev render <projectId> --renderer hyperframes
bun run dev render <projectId> --renderer hyperframes --hyperframes-validate
bun run dev render <projectId> --renderer hyperframes --hyperframes-render --hyperframes-command '["npx","hyperframes"]'
bun run dev export <projectId> --output ./final.mp4
bun run dev export <projectId> --require-quality --output ./final.mp4
bun run dev export <projectId> --format hyperframes --output ./hyperframes-render
```

当前 CLI 入口：

```text
vagent init
vagent doctor
vagent config
vagent provider-env
vagent inspect
vagent run
vagent artifacts
vagent events
vagent projects
vagent quality
vagent visual
vagent rerun
vagent status
vagent worker
vagent tui
vagent serve
vagent mcp
vagent render
vagent export
```

`inspect` 会调用 `ffprobe` 并写出：

```text
.video-agent/projects/<projectId>/artifacts/media-info.json
```

`doctor` 会检查当前运行时、workspace、配置、项目索引和本地媒体工具：

```text
bun
workspace
config
provider:asr
provider:vlm
provider:tts
projects
ffmpeg
ffprobe
```

## Provider 配置

可以用交互模式逐项配置 provider、job store 和 retry：

```sh
bun run dev config --interactive
```

默认 provider 都是 `mock`。也可以配置为 `command`，让 video-agent 调用外部命令作为 ASR/VLM/TTS adapter。外部命令通过 stdin 接收 JSON，通过 stdout 返回 JSON。

```sh
bun run dev config --asr command --vlm command --tts command
export VIDEO_AGENT_ASR_COMMAND='["node","./providers/asr.js"]'
export VIDEO_AGENT_VLM_COMMAND='["node","./providers/vlm.js"]'
export VIDEO_AGENT_TTS_COMMAND='["node","./providers/tts.js"]'
```

也可以配置为 `http`，让 video-agent 以 POST JSON 的方式调用外部 ASR/VLM/TTS 服务。HTTP provider 和 command provider 使用同一套 request/response contract，也支持 `{ data, metadata }` response envelope。

```sh
bun run dev config --asr http --vlm http --tts http
export VIDEO_AGENT_ASR_URL='https://provider.example/asr'
export VIDEO_AGENT_VLM_URL='https://provider.example/vlm'
export VIDEO_AGENT_TTS_URL='https://provider.example/tts'
```

可选环境变量：

```text
VIDEO_AGENT_ASR_TOKEN / VIDEO_AGENT_VLM_TOKEN / VIDEO_AGENT_TTS_TOKEN
VIDEO_AGENT_ASR_TIMEOUT_MS / VIDEO_AGENT_VLM_TIMEOUT_MS / VIDEO_AGENT_TTS_TIMEOUT_MS
```

可以用 `provider-env` 按当前 workspace config 输出 provider 需要的环境变量、必填/可选状态和是否已配置。它只显示变量名和配置状态，不输出 token 或 endpoint 具体值：

```sh
bun run dev provider-env
bun run dev provider-env --json
```

job state 默认写入每个项目目录的 `job-state.json`。如果要让本地 worker/API 使用 workspace 级 SQLite 状态库，可以切换为：

```sh
bun run dev config --job-store sqlite
```

SQLite backend 会写入：

```text
.video-agent/state/jobs.db
```

pipeline 默认不重试 stage。可以配置每个 stage 失败后的重试次数和退避时间：

```sh
bun run dev config --max-stage-retries 2 --retry-backoff-ms 500
```

重试会写入 `pipeline-events.jsonl`，事件包含 `attempt` / `maxAttempts`，并在 `job-state` 的 stage 状态里记录当前 attempt。

输入 payload 会包含 `kind` 和 `version` 字段：

```text
ASR: { kind: "asr", version: 1, input: { path } }
VLM: { kind: "vlm", version: 1, input: SceneFrameBatch[], context? }
TTS: { kind: "tts", version: 1, segments: NarrationSegment[] }
```

输出需要匹配当前 provider contracts：

```text
ASR -> Transcript
VLM -> VLMScene[]
TTS -> TTSSegment[]
```

`run` 会执行第一版最小 pipeline：

```text
ingest -> mock understand -> placeholder plan -> placeholder script -> mock voiceover -> quality report
```

并写出：

```text
ingest-report.json
media-info.json
transcript.json
scene-analysis.json
storyboard.json
timeline.json
narration.json
tts-segments.json
quality-report.json
pipeline-events.jsonl
provider-calls.jsonl
artifact-manifest.json
job-state.json
frames/frame_%05d.jpg
renders/preview.mp4
```

`quality-report.json` 会检查 timeline 越界、narration start/duration 完整性、narration 重叠或越界、TTS 是否覆盖每个 narration、TTS duration 是否明显偏离 narration timing，以及 TTS 是否引用未知 narration。

`render` 会读取项目的 `timeline.json`，用 `ffmpeg` 输出：

```text
.video-agent/projects/<projectId>/renders/final.mp4
.video-agent/projects/<projectId>/renders/final-frame-first.jpg
.video-agent/projects/<projectId>/renders/final-frame-middle.jpg
.video-agent/projects/<projectId>/renders/final-frame-end.jpg
.video-agent/projects/<projectId>/renders/subtitles.srt
.video-agent/projects/<projectId>/artifacts/voiceover-plan.json
.video-agent/projects/<projectId>/artifacts/render-output.json
```

默认情况下，如果存在 `narration.json`，`render` 会生成并烧录字幕。可以用 `--no-subtitles` 关闭字幕烧录，走更快的 copy 渲染路径。

启用字幕时，`render-output.json` 会包含 `subtitleQuality`，检查 SRT cue 数量、时间格式、非正时长、重叠、越界和空文本。

ffmpeg 渲染成功后，`render-output.json` 还会包含 `outputQuality`，用 `ffprobe` 检查最终视频的时长、视频流数量和预期音频流；如果无法探测产物，会记录 `render.output.probe_failed` warning，但不会丢弃已经生成的视频。

如果最终视频包含音轨，`render-output.json` 还会包含 `audioQuality`。它通过 `ffmpeg volumedetect` 读取 mean/max volume，并对过静、过响、接近削波或探测失败写入 warning；项目级 `status` / `quality` 聚合会把这些 audio warning 计入 render diagnostics。

如果最终视频包含视频流，`render-output.json` 还会包含 `visualQuality`。它通过 `ffmpeg blackdetect` 读取黑屏片段和黑屏占比，并抽取 first/middle/end 三张缩略图样本；`frameSamples` 保存完整样本列表，`frameSample` 保留第一张样本作为兼容字段。黑屏占比较高会写入 warning，几乎全黑会写入 error，缩略图抽样失败会写入 warning，并纳入项目级 `status` / `quality` 聚合。

如果项目里存在 `audio/source.wav` 或 `tts-segments.json` 指向的真实音频文件，`render` 会混入可用音频并输出 AAC 音轨。mock TTS 的占位路径如果不存在，会在 `voiceover-plan.json`、`render-output.json` 和 CLI 输出里记录 missing voiceover diagnostic；可以用 `--no-audio` 关闭音频混合。

`voiceover-plan.json` 会记录每段 TTS 的 `start`、`duration`、`narrationId`、resolved path、`available/missing/invalid-path` 状态和 `alignment` 来源。对同一个 `narrationId` 返回的多段 TTS chunk 会按 duration 顺序拼接，后续 Web Studio/TUI 可以直接用它做旁白对齐检查。

可以调节源音频和旁白音量，也可以启用 voiceover sidechain ducking：

```sh
bun run dev render <projectId> --inspect-audio
bun run dev render <projectId> --source-volume 0.8 --voiceover-volume 1.2
bun run dev render <projectId> --audio-ducking --ducking-threshold 0.02 --ducking-ratio 10
```

`--inspect-audio` 会读取同一套 ffmpeg render options，但只输出音频输入、缺失 voiceover 和 `voiceover-plan` 诊断，不执行渲染。它适合在真实 TTS 音频接入前检查旁白时间轴和文件路径。

也可以生成 HyperFrames/HTML 渲染项目：

```text
.video-agent/projects/<projectId>/renders/hyperframes/index.html
.video-agent/projects/<projectId>/renders/hyperframes/render-plan.json
.video-agent/projects/<projectId>/renders/hyperframes/styles.css
```

如果本机已经安装 HyperFrames CLI，可以让 `render` 在生成 HTML 项目后继续调用外部 CLI：

```sh
bun run dev render <projectId> --renderer hyperframes --hyperframes-validate
bun run dev render <projectId> --renderer hyperframes --hyperframes-render --hyperframes-output ./hyperframes.mp4
```

默认命令前缀是 `["hyperframes"]`。如果需要通过 npx 调用，可以传：

```sh
--hyperframes-command '["npx","hyperframes"]'
```

`export` 会复制已渲染的产物到目标路径，并写出：

```text
.video-agent/projects/<projectId>/artifacts/export-output.json
```

默认导出不会强制质量门禁。需要交付前硬性检查时，可以传 `--require-quality`；它会先运行项目级 `quality` 聚合，只有 pipeline quality、render diagnostics 和 artifact integrity 都干净时才导出。

`artifacts --verify` 会读取 `artifact-manifest.json`，重新计算 sha256，并报告缺失、变更和未纳入 manifest 的文件：

```sh
bun run dev artifacts <projectId> --verify
```

`status` 会读取 `job-state.json`、artifact 列表、`pipeline-events.jsonl`、`provider-calls.jsonl`、`quality-report.json` 和 `render-output.json`，展示 stage 状态、事件数量、provider 调用总数、失败数、quality warning/error summary 和 render output diagnostics。

`quality` 会聚合 pipeline quality、render diagnostics 和 artifact integrity，给出项目是否可交付的 `ok/errors/warnings` 总结。`--details` 会一并输出原始 `quality-report.json` 和 `render-output.json` 内容。

`visual` 会读取 `render-output.json` 中记录的渲染缩略图样本，输出时间点、状态、相对路径和文件大小。默认只输出元数据；`--json --include-content` 会额外返回 base64 图像内容。

`events` 会读取同一组 JSONL 日志，输出按时间排序的 pipeline events 和 provider calls。可以用 `--kind provider`、`--role asr`、`--status failed`、`--limit 20` 过滤。

`rerun` 会读取项目的 `job-state.json`，复用原始 `inputPath`，从指定 checkpoint 阶段继续执行：

```sh
bun run dev rerun <projectId> --from-stage script
```

`run --from-stage` 和 `rerun --from-stage` 会在启动前校验该 checkpoint 依赖的 artifacts。缺失时会一次性列出缺少的文件；如果存在 `artifact-manifest.json`，还会拒绝使用 hash/size 已变化或未纳入 manifest 的前置 artifact。校验失败不会把 job state 写成新的运行。

`worker` 会扫描 workspace 内 failed/running 的本地 job，从第一个 failed/running/pending stage 恢复执行。可以用 `--dry-run` 查看将恢复哪些项目，用 `--status failed|running|active` 过滤状态，用 `--limit` 控制本轮恢复数量，用 `--max-attempts` 跳过已经达到 stage attempt 上限的 job。跳过结果会带 `skipReason`，例如 `attempt-limit`、`limit` 或 `not-recoverable`。

`tui` 会输出轻量终端 dashboard，复用 runtime 的 project/status/events/artifacts 接口展示当前 workspace、最近更新项目、stage 状态、质量摘要、render 摘要、artifact 列表和最近事件。默认渲染一次；需要持续刷新时可以传 `--watch`，也可以用 `--project <projectId>` 固定查看某个项目。需要从 TUI 入口触发受控操作时，可以用 `--action artifact --artifact <name>` 检查 artifact，用 `--action rerun --from-stage <stage>` 重跑项目，或用 `--action worker --dry-run|--status|--limit|--max-attempts` 恢复 workspace job。

`serve` 会启动 Bun HTTP API server，暴露 runtime state、workflow actions 和本地 worker recovery：

```text
GET /health
GET /doctor
GET /provider-env
GET /projects
POST /projects
POST /worker
GET /projects/:projectId/status
GET /projects/:projectId/quality
GET /projects/:projectId/events
GET /projects/:projectId/artifacts
GET /projects/:projectId/artifacts/:artifactName
GET /projects/:projectId/artifacts/verify
GET /projects/:projectId/audio
GET /projects/:projectId/visual
POST /projects/:projectId/rerun
POST /projects/:projectId/render
POST /projects/:projectId/export
```

`mcp` 会启动 stdio MCP adapter，支持 `initialize`、`tools/list` 和 `tools/call`，工具直接复用 runtime API：

```text
video_agent_doctor
video_agent_list_projects
video_agent_provider_env
video_agent_status
video_agent_quality
video_agent_visual_samples
video_agent_events
video_agent_artifacts
video_agent_verify_artifacts
video_agent_run
video_agent_rerun
video_agent_render
video_agent_inspect_audio
video_agent_worker
video_agent_export
```

`video_agent_render` 支持 ffmpeg 音频开关、source/voiceover volume、sidechain ducking 参数，以及 HyperFrames validate/render/output/command 参数。`video_agent_inspect_audio` 支持同一组音频相关参数，用于在真正渲染前检查 voiceover 对齐和可用音频输入。

`video_agent_provider_env` 返回当前 provider 配置对应的环境变量契约，只暴露变量名、必填状态和是否已配置，不返回具体值。

`video_agent_worker` 复用本地 worker recovery runtime，可 dry-run 扫描 failed/running job，也可以用 `status` 和 `limit` 控制恢复范围。

可以用 `--print-config` 输出通用 MCP client stdio 配置。开发期默认用 `bun run dev mcp`，发布后可以用 `--config-mode installed` 输出 `vagent mcp` 配置：

```sh
bun run dev mcp --print-config
bun run dev mcp --print-config --config-mode installed
```

`POST /projects` 会从 input path 启动 pipeline：

```json
{
  "inputPath": "./input.mp4",
  "projectId": "demo",
  "fromStage": "ingest"
}
```

`POST /worker` 会扫描 workspace 内 failed/running 的本地 job，并从第一个未完成 stage 恢复执行。可以先 dry-run：

```json
{
  "dryRun": true,
  "maxAttempts": 3,
  "status": "active",
  "limit": 5
}
```

`status` 可选值为 `active`、`failed`、`running`；`active` 表示同时扫描 failed 和 running。

`POST /projects/:projectId/rerun` 接收可选 JSON body：

```json
{
  "fromStage": "quality"
}
```

如果 checkpoint artifacts 不完整，HTTP API 会返回 `409`，并在 `error.missingArtifacts`、`error.changedArtifacts`、`error.untrackedArtifacts` 中列出问题文件。

`POST /projects/:projectId/render` 接收和 CLI render 对应的 JSON body：

```json
{
  "renderer": "ffmpeg",
  "sourceVolume": 0.8,
  "voiceoverVolume": 1.2,
  "audioDucking": true,
  "duckingThreshold": 0.02,
  "duckingRatio": 10
}
```

`GET /projects/:projectId/artifacts/verify` 会返回 artifact integrity check 结果，包含 `ok`、`checked`、`missing`、`changed` 和 `untracked`。

`GET /projects/:projectId/audio` 会返回和 `render --inspect-audio --json` 相同的音频预检结果。支持通过 query string 传入 `audio`、`sourceVolume`、`voiceoverVolume`、`audioDucking`、`duckingThreshold`、`duckingRatio`、`duckingAttackMs` 和 `duckingReleaseMs`。

`GET /projects/:projectId/visual` 会读取 `render-output.json` 中的 `visualQuality.frameSamples`，返回渲染缩略图样本的路径、相对路径、时间点、文件大小和存在状态。默认只返回元数据；传 `includeContent=true` 时会额外返回 JPEG 的 base64 内容，MCP 工具 `video_agent_visual_samples` 使用同一套 runtime 接口。

`POST /projects/:projectId/export` 接收和 CLI export 对应的 JSON body：

```json
{
  "format": "video",
  "outputPath": "./final.mp4",
  "requireQuality": true
}
```

## 常用脚本

```sh
bun run dev <command>   # 使用 Bun 运行 oclif 开发入口
bun run build           # 清理并编译根项目和 packages
bun run test            # 运行测试，并在 posttest 中执行 lint
bun run lint            # ESLint
bun run clean           # 清理 dist 和 tsbuildinfo
```

## 当前状态

已完成：

- Bun workspace 基础配置
- 核心 package 边界
- Zod IR schema
- stage pipeline contract
- artifact store / event bus
- ffmpeg / ffprobe wrapper
- `inspect` 命令：probe 媒体并写 `media-info.json`
- `doctor` 命令：检查 Bun/Node fallback、workspace、配置、项目索引、`ffmpeg` 和 `ffprobe`
- doctor provider checks：当 provider 设为 `command` 或 `http` 时，检查对应 `VIDEO_AGENT_*_COMMAND` / `VIDEO_AGENT_*_URL`
- `provider-env` 命令：按当前 config 输出 ASR/VLM/TTS provider 所需环境变量、必填/可选状态和配置状态，且不泄露 secret 值
- `run` 命令：通过 `JobRunner` 生成 ingest、mock understand、placeholder storyboard/timeline/narration、mock TTS、quality artifacts、frames 和 preview
- quality report：检查 timeline bounds、narration timing 和 TTS coverage，并输出 warning/error summary
- `artifacts` 命令：列出项目 artifacts，或读取单个 JSON/text artifact
- artifact verify：CLI/API 可按 `artifact-manifest.json` 校验 sha256，报告 missing/changed/untracked
- `events` 命令：按时间读取 pipeline events 和 provider calls，支持 provider role/status/limit 过滤
- `projects` 命令：列出 workspace 内已有项目
- `quality` 命令：聚合 pipeline quality、render diagnostics 和 artifact integrity，输出可交付性 summary
- `visual` 命令：读取渲染缩略图样本元数据，并可选输出 base64 图像内容
- `rerun` 命令：读取已有 project 的 job state，从指定 checkpoint stage 重跑
- `worker` 命令：扫描 failed/running job，并从第一个未完成 stage 做单机恢复，支持 attempt 上限和 skip reason
- `tui` 命令：提供轻量终端 dashboard，展示项目、stage、质量摘要、artifact 和最近事件，支持 watch 刷新，并可通过 action flag 检查 artifact、触发 rerun 或 worker recovery
- `serve` 命令：启动 Bun HTTP API server，暴露 health、provider-env、projects、status、events、artifacts、workflow actions 和 worker recovery
- `mcp` 命令：启动 stdio MCP server，暴露 doctor/provider-env/projects/status/events/artifacts/run/rerun/render/audio/visual/worker/export 工具
- MCP render/audio tools：`video_agent_render` 和 `video_agent_inspect_audio` 暴露 ffmpeg 音量、ducking 和 HyperFrames 外部 CLI 参数
- MCP worker tool：`video_agent_worker` 复用 runtime worker recovery，可 dry-run、按状态/数量恢复 failed/running job，或用 `maxAttempts` 跳过已达到 attempt 上限的 job
- API workflow actions：支持 `POST /projects`、`POST /worker`、`POST /projects/:id/rerun`、`POST /projects/:id/render`、`POST /projects/:id/export`
- `render` 命令：用 ffmpeg 从 timeline 输出第一版 `final.mp4`，并可从 `narration.json` 生成/烧录字幕；也支持 `--renderer hyperframes` 生成 HTML render project
- subtitle quality：ffmpeg render 会对生成的 SRT 文件写入 cue 数量和 warning/error diagnostics
- runtime render API：CLI `render` 和 HTTP `POST /projects/:id/render` 共用同一套 `renderProject`
- ffmpeg renderer：支持混入提取出的源音频和已存在的 TTS voiceover 音频，输出 AAC 音轨
- ffmpeg audio controls：支持 source/voiceover volume 和可选 sidechain ducking
- render output quality：ffmpeg render 会探测最终视频，记录视频流、音频流、时长、音频响度、黑屏烟测和多点缩略图样本 diagnostics
- voiceover plan：render 阶段写出 `voiceover-plan.json`，记录 TTS 段和 narration 时间轴的对齐状态，并支持同一 narration 的多段 TTS chunk 顺序拼接
- render audio diagnostics：缺失的 TTS voiceover 文件会写入 `render-output.json`，CLI 非 JSON 输出也会打印 audio warning
- render audio preflight：CLI `render --inspect-audio` 和 HTTP `GET /projects/:id/audio` 可在渲染前检查 voiceover alignment 和可用音频输入
- render visual samples：CLI `visual`、HTTP `GET /projects/:id/visual` 和 MCP `video_agent_visual_samples` 可读取渲染缩略图样本元数据，并可选返回 base64 图像内容
- HyperFrames renderer：支持生成 HTML 项目，并可选调用 HyperFrames CLI validate/render
- `export` 命令：导出 `final.mp4`、HyperFrames render directory 或完整 project bundle
- export quality gate：`export --require-quality` / API `requireQuality` 可在质量聚合不通过时拒绝导出
- `init` 命令：初始化 workspace 并检查 `ffmpeg` / `ffprobe`
- `config` 命令：读写 provider、job store 和 retry 配置，支持轻量交互模式
- provider registry：支持 `mock`、`command` 和 `http` provider，`command` / `http` 通过环境变量配置外部 JSON adapter
- provider call recorder：记录 ASR/VLM/TTS 调用的 provider、request id、耗时、输入/输出摘要、model/usage/cost metadata、状态和错误信息到 `provider-calls.jsonl`
- artifact manifest：`artifact-manifest.json` 记录 artifacts 目录内文件的 kind、size、mtime 和 sha256，用于后续恢复/校验
- pipeline retry policy：支持配置 stage 级 `maxStageRetries` 和 `retryBackoffMs`，事件和 job state 会记录 attempt
- checkpoint validation：`run --from-stage` / `rerun --from-stage` 会显式校验前置 artifacts，并在 manifest 可用时校验 hash/size；API 对不完整 checkpoint 返回 409
- `status` 命令：读取 durable `job-state.json`，展示 stage 状态和 artifact 摘要
- project status summary：聚合 pipeline event 数量、最近事件、provider call 成功/失败摘要、成本摘要、quality issue 摘要和 render output/audio/visual quality 摘要
- db package：提供 JSON `JobStore` 和 Bun SQLite `JobStore`，runtime 可通过 `config --job-store json|sqlite` 切换
- GitHub Actions 切换到 Bun
- 架构文档

下一步建议：

1. 增加 Clack 交互式配置。
2. 增加真实 ASR/VLM/TTS provider adapter。
3. 增加 worker retry 调度和更细的 artifact 恢复策略。
4. 扩展 MCP 工具的 schema 注释和客户端集成示例。
5. 扩展更深的视觉烟测。

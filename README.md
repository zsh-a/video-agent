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

更完整的架构说明见 [docs/architecture.md](./docs/architecture.md)。

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
  media/                  # ffmpeg / ffprobe / process wrapper
  providers/              # ASR / VLM / TTS provider interfaces
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
bun run dev hello world
```

当前 `hello` 命令仍是 oclif scaffold 的占位命令。后续会替换为：

```text
vagent run
vagent inspect
vagent render
vagent export
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
- GitHub Actions 切换到 Bun
- 架构文档

下一步建议：

1. 用 `run`、`inspect`、`render` 替换 demo `hello` 命令。
2. 增加 `Workspace` 对象，统一创建项目目录和 checkpoint artifact。
3. 实现 `ffprobe` ingest stage，输出 `media-info.json`。
4. 跑通第一条最小 pipeline：`ingest -> plan -> render placeholder`。
5. 再接入 Clack/TUI/MCP，而不是把这些逻辑写进 core。

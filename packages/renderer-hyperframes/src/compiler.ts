import type {Narration, Storyboard, Timeline} from '@video-agent/ir'

import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunWrite} from './bun-runtime.js'

export interface HyperframesRenderPlan {
  assetsDir: string
  duration: number
  entryHtml: string
  narration?: Narration
  outputDir: string
  storyboard: Storyboard
  timeline: Timeline
}

export interface WriteHyperframesProjectInput {
  narration?: Narration
  outputDir: string
  storyboard: Storyboard
  timeline: Timeline
}

export interface WriteHyperframesProjectResult {
  entryHtml: string
  outputDir: string
  planPath: string
  stylesPath: string
}

export function createHyperframesRenderPlan(input: HyperframesRenderPlan): HyperframesRenderPlan {
  return input
}

export async function writeHyperframesProject(input: WriteHyperframesProjectInput): Promise<WriteHyperframesProjectResult> {
  const outputDir = resolve(input.outputDir)
  const assetsDir = resolve(outputDir, 'assets')
  const entryHtml = resolve(outputDir, 'index.html')
  const planPath = resolve(outputDir, 'render-plan.json')
  const stylesPath = resolve(outputDir, 'styles.css')
  const plan = createHyperframesRenderPlan({
    assetsDir,
    duration: input.timeline.duration,
    entryHtml,
    narration: input.narration,
    outputDir,
    storyboard: input.storyboard,
    timeline: input.timeline,
  })

  await mkdir(assetsDir, {recursive: true})
  await bunWrite(planPath, `${JSON.stringify(plan, null, 2)}\n`)
  await bunWrite(stylesPath, createStyles())
  await bunWrite(entryHtml, createHtml(plan))

  return {
    entryHtml,
    outputDir,
    planPath,
    stylesPath,
  }
}

function createHtml(plan: HyperframesRenderPlan): string {
  const narrationBySceneId = new Map(plan.narration?.segments.flatMap((segment) => (segment.sceneId === undefined ? [] : [[segment.sceneId, segment]])) ?? [])
  const scenes = plan.storyboard.scenes
    .map(
      (scene, index) => `<section class="scene" style="--start:${scene.start}s;--duration:${scene.duration}s">
  <div class="scene__shell">
    <header class="scene__header">
      <span class="scene__eyebrow">Slide ${index + 1}</span>
      <span class="scene__time">${escapeHtml(formatTimeRange(scene.start, scene.duration))}</span>
    </header>
    <div class="scene__layout">
      <article class="scene__body">
        <h1>${escapeHtml(createSceneTitle(scene, index))}</h1>
        <ul class="scene__bullets">
${createBulletItems(scene, narrationBySceneId.get(scene.id)).map((item) => `          <li>${escapeHtml(item)}</li>`).join('\n')}
        </ul>
      </article>
      <aside class="scene__context">
        <span class="scene__style">${escapeHtml(formatVisualStyle(scene.visualStyle))}</span>
        <p>${escapeHtml(createEvidenceSummary(scene))}</p>
      </aside>
    </div>
  </div>
</section>`,
    )
    .join('\n')
  const narration = plan.narration?.segments
    .map((segment) => `<p class="caption" data-start="${segment.start ?? 0}" data-duration="${segment.duration ?? 1}">${escapeHtml(segment.text)}</p>`)
    .join('\n')

  return `<!doctype html>
<html lang="${escapeHtml(plan.storyboard.language)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>video-agent HyperFrames render</title>
  <link rel="stylesheet" href="./styles.css" />
  <script type="application/json" id="render-plan">${escapeHtml(JSON.stringify(plan))}</script>
</head>
<body>
  <main class="stage" data-duration="${plan.duration}">
${scenes}
  </main>
  <aside class="captions">
${narration ?? ''}
  </aside>
</body>
</html>
`
}

function createStyles(): string {
  return `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  background: #f5f7f8;
  color: #17201b;
}

.stage {
  aspect-ratio: 16 / 9;
  background: #f5f7f8;
  isolation: isolate;
  min-height: 100vh;
  overflow: hidden;
  position: relative;
}

.scene {
  animation: show-scene var(--duration) linear var(--start) forwards;
  inset: 0;
  opacity: 0;
  position: absolute;
}

.scene__shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 36px;
  height: 100%;
  padding: 56px 64px;
}

.scene__header {
  align-items: center;
  border-bottom: 1px solid #d7ded9;
  display: flex;
  justify-content: space-between;
  padding-bottom: 18px;
}

.scene__eyebrow,
.scene__time,
.scene__style {
  color: #3f6f5a;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.scene__layout {
  align-items: stretch;
  display: grid;
  flex: 1;
  gap: 44px;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 34%);
}

.scene__body {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.scene h1 {
  color: #17201b;
  font-size: 56px;
  line-height: 1.08;
  letter-spacing: 0;
  margin: 0 0 32px;
  max-width: 920px;
}

.scene__bullets {
  display: grid;
  gap: 18px;
  list-style: none;
  margin: 0;
  max-width: 900px;
  padding: 0;
}

.scene__bullets li {
  background: #ffffff;
  border-left: 6px solid #3f6f5a;
  border-radius: 8px;
  box-shadow: 0 18px 48px rgb(23 32 27 / 10%);
  color: #24312b;
  font-size: 26px;
  line-height: 1.38;
  padding: 18px 22px;
}

.scene__context {
  align-self: center;
  background: #e5efe9;
  border: 1px solid #c5d5cc;
  border-radius: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 360px;
  padding: 28px;
}

.scene__context p,
.caption {
  font-size: 20px;
  line-height: 1.5;
}

.captions {
  bottom: 28px;
  left: 64px;
  position: fixed;
  right: 64px;
  z-index: 10;
}

.caption {
  background: rgb(23 32 27 / 86%);
  border-radius: 6px;
  color: #f8fbf9;
  margin: 8px auto;
  max-width: 1100px;
  padding: 10px 14px;
  text-align: center;
}

@keyframes show-scene {
  0%,
  99.8% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
}
`
}

function createSceneTitle(scene: Storyboard['scenes'][number], index: number): string {
  const title = scene.narration?.split(/[。.!！？?；;]/u)[0]?.replace(/^第\s*\d+\s*页[：:]\s*/u, '').trim()

  return title === undefined || title === '' ? `Slide ${index + 1}` : title
}

function createBulletItems(scene: Storyboard['scenes'][number], narration: Narration['segments'][number] | undefined): string[] {
  const source = narration?.text ?? scene.narration ?? createEvidenceSummary(scene)
  const cleaned = source.replace(/^第\s*\d+\s*页[：:]\s*/u, '').trim()
  const parts = cleaned
    .split(/[。.!！？?；;]\s*/u)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return ['Explain the key point for this section.']
  }

  return parts.slice(0, 4)
}

function createEvidenceSummary(scene: Storyboard['scenes'][number]): string {
  const evidenceText = scene.evidence
    .map((item) => item.text?.trim())
    .filter((value): value is string => value !== undefined && value !== '')
    .slice(0, 2)
    .join(' ')

  return evidenceText === '' ? 'Text-driven explainer slide generated from the video plan.' : evidenceText
}

function formatVisualStyle(value: string): string {
  return value.replaceAll(/[_-]+/g, ' ')
}

function formatTimeRange(start: number, duration: number): string {
  return `${formatTime(start)} - ${formatTime(start + duration)}`
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60)
  const seconds = Math.max(0, Math.round(value - minutes * 60))

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

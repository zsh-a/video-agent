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
    .map((scene, index) => {
      const narration = resolveNarrationForScene(plan, narrationBySceneId, scene.id, index)

      return `<section class="scene" data-start="${scene.start}" data-duration="${scene.duration}" style="--start:${scene.start}s;--duration:${scene.duration}s">
  <div class="scene__shell">
    <header class="scene__header">
      <span class="scene__eyebrow">Slide ${index + 1}</span>
      <span class="scene__time">${escapeHtml(formatTimeRange(scene.start, scene.duration))}</span>
    </header>
    <div class="scene__layout">
      <article class="scene__body">
        <h1>${escapeHtml(createSceneTitle(scene, index))}</h1>
        <ul class="scene__bullets">
${createBulletItems(scene, narration).map((item) => `          <li>${escapeHtml(item)}</li>`).join('\n')}
        </ul>
      </article>
      <aside class="scene__context">
        <span class="scene__style">${escapeHtml(formatVisualStyle(scene.visualStyle))}</span>
        <p>${escapeHtml(createEvidenceSummary(scene))}</p>
      </aside>
    </div>
${narration === undefined ? '' : `    <p class="caption" data-start="${narration.start ?? scene.start}" data-duration="${narration.duration ?? scene.duration}">${escapeHtml(narration.text)}</p>`}
  </div>
</section>`
    })
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
</body>
</html>
`
}

function resolveNarrationForScene(
  plan: HyperframesRenderPlan,
  narrationBySceneId: Map<string, Narration['segments'][number]>,
  sceneId: string,
  sceneIndex: number,
): Narration['segments'][number] | undefined {
  return narrationBySceneId.get(sceneId) ?? plan.narration?.segments[sceneIndex]
}

function createStyles(): string {
  return `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  background: #eef2f7;
  color: #111827;
}

.stage {
  box-sizing: border-box;
  display: grid;
  gap: 28px;
  justify-items: center;
  min-height: 100vh;
  padding: 28px;
}

.scene {
  aspect-ratio: 16 / 9;
  background:
    linear-gradient(135deg, rgb(37 99 235 / 8%), transparent 34%),
    linear-gradient(315deg, rgb(249 115 22 / 10%), transparent 28%),
    #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgb(15 23 42 / 12%);
  overflow: hidden;
  position: relative;
  width: min(1280px, 100%);
}

.scene__shell {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 24px;
  height: 100%;
  padding: 44px 52px;
}

.scene__header {
  align-items: center;
  border-bottom: 1px solid #dbe3ef;
  display: flex;
  gap: 24px;
  justify-content: space-between;
  padding-bottom: 16px;
}

.scene__eyebrow,
.scene__time,
.scene__style {
  color: #2563eb;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.scene__layout {
  align-items: stretch;
  display: grid;
  flex: 1;
  gap: 32px;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 30%);
  min-height: 0;
}

.scene__body {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.scene h1 {
  color: #0f172a;
  font-size: 42px;
  line-height: 1.16;
  letter-spacing: 0;
  margin: 0 0 24px;
  max-width: 860px;
}

.scene__bullets {
  display: grid;
  gap: 14px;
  list-style: none;
  margin: 0;
  max-width: 860px;
  padding: 0;
}

.scene__bullets li {
  background: #ffffff;
  border: 1px solid #dbe3ef;
  border-left: 6px solid #f97316;
  border-radius: 8px;
  box-shadow: 0 10px 24px rgb(15 23 42 / 8%);
  color: #1f2937;
  font-size: 22px;
  line-height: 1.36;
  padding: 14px 18px;
}

.scene__context {
  align-self: center;
  background: #f8fafc;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 280px;
  padding: 24px;
}

.scene__context p,
.caption {
  font-size: 18px;
  line-height: 1.5;
}

.caption {
  background: rgb(15 23 42 / 88%);
  border-radius: 6px;
  color: #f8fafc;
  margin: 0;
  padding: 10px 14px;
  text-align: center;
}

@media (max-width: 760px) {
  .stage {
    padding: 16px;
  }

  .scene {
    aspect-ratio: auto;
  }

  .scene__shell {
    min-height: 620px;
    padding: 28px 24px;
  }

  .scene__header,
  .scene__layout {
    grid-template-columns: 1fr;
  }

  .scene__header {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .scene h1 {
    font-size: 30px;
  }

  .scene__bullets li {
    font-size: 18px;
  }

  .scene__context {
    min-height: 0;
  }
}

@media print {
  body {
    background: #ffffff;
  }

  .stage {
    display: block;
    padding: 0;
  }

  .scene {
    border: 0;
    border-radius: 0;
    box-shadow: none;
    page-break-after: always;
    width: 100%;
  }
}
`
}

function createSceneTitle(scene: Storyboard['scenes'][number], index: number): string {
  const title = splitIntoSentences(scene.narration ?? '')[0]?.replace(/^第\s*\d+\s*页[：:]\s*/u, '').trim()

  return title === undefined || title === '' ? `Slide ${index + 1}` : title
}

function createBulletItems(scene: Storyboard['scenes'][number], narration: Narration['segments'][number] | undefined): string[] {
  const source = narration?.text ?? scene.narration ?? createEvidenceSummary(scene)
  const cleaned = source.replace(/^第\s*\d+\s*页[：:]\s*/u, '').trim()
  const parts = splitIntoSentences(cleaned)

  if (parts.length === 0) {
    return ['Explain the key point for this section.']
  }

  return parts.slice(0, 4)
}

function splitIntoSentences(value: string): string[] {
  return value
    .split(/[。!！？?；;]|\.(?!\d)/u)
    .map((part) => part.trim())
    .filter(Boolean)
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

import type {Narration, Storyboard, Timeline} from '@video-agent/ir'

import {mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

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
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`)
  await writeFile(stylesPath, createStyles())
  await writeFile(entryHtml, createHtml(plan))

  return {
    entryHtml,
    outputDir,
    planPath,
    stylesPath,
  }
}

function createHtml(plan: HyperframesRenderPlan): string {
  const scenes = plan.storyboard.scenes
    .map(
      (scene, index) => `<section class="scene" style="--start:${scene.start}s;--duration:${scene.duration}s">
  <div class="scene__index">${index + 1}</div>
  <div class="scene__body">
    <h1>${escapeHtml(scene.visualStyle)}</h1>
    <p>${escapeHtml(scene.narration ?? '')}</p>
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
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  background: #111;
  color: #f7f7f2;
}

.stage {
  align-items: center;
  aspect-ratio: 16 / 9;
  background: #171717;
  display: grid;
  gap: 24px;
  grid-auto-flow: column;
  min-height: 100vh;
  overflow: hidden;
  padding: 48px;
}

.scene {
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  display: grid;
  gap: 16px;
  min-height: 360px;
  padding: 24px;
  width: min(520px, 80vw);
}

.scene__index {
  color: #88d498;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0;
}

.scene h1 {
  font-size: 32px;
  letter-spacing: 0;
  margin: 0 0 12px;
}

.scene p,
.caption {
  font-size: 18px;
  line-height: 1.5;
}

.captions {
  bottom: 32px;
  left: 48px;
  position: fixed;
  right: 48px;
}

.caption {
  background: rgb(0 0 0 / 72%);
  border-radius: 6px;
  margin: 8px auto;
  max-width: 960px;
  padding: 10px 14px;
  text-align: center;
}
`
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

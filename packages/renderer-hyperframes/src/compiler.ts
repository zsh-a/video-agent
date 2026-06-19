import type {Narration, Storyboard, Timeline} from '@video-agent/ir'

import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunWrite} from './bun-runtime.js'

import styles from './styles.css' with { type: 'text' }

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
  await bunWrite(stylesPath, styles)
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

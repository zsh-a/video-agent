import type {Narration, Storyboard, Timeline} from '@video-agent/ir'

import {mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunWrite} from './bun-runtime.js'

import styles from './styles.css' with { type: 'text' }

export interface HyperframesRenderPlan {
  assetsDir: string
  duration: number
  entryHtml: string
  narration: Narration
  outputDir: string
  storyboard: Storyboard
  timeline: Timeline
}

export interface WriteHyperframesProjectInput {
  narration: Narration
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
  const narrationBySceneId = indexNarrationBySceneId(plan.narration)
  const scenes = plan.storyboard.scenes
    .map((scene, index) => {
      const narration = resolveNarrationForScene(narrationBySceneId, scene.id)
      const evidenceRefs = createEvidenceRefItems(scene)

      return `<section class="scene" data-start="${scene.start}" data-duration="${scene.duration}" style="--start:${scene.start}s;--duration:${scene.duration}s">
  <div class="scene__shell">
    <header class="scene__header">
      <span class="scene__eyebrow">Slide ${index + 1}</span>
      <span class="scene__time">${escapeHtml(formatTimeRange(scene.start, scene.duration))}</span>
    </header>
    <div class="scene__layout">
      <article class="scene__body">
        <h1>Scene ${index + 1}</h1>
        <p class="scene__narration">${escapeHtml(resolveSceneNarrationText(scene, narration))}</p>
      </article>
      <aside class="scene__context">
        <span class="scene__style">${escapeHtml(formatVisualStyle(scene.visualStyle))}</span>
${evidenceRefs.length === 0 ? '' : `        <ul class="scene__evidence">
${evidenceRefs.map((item) => `          <li>${escapeHtml(item)}</li>`).join('\n')}
        </ul>`}
      </aside>
    </div>
    <p class="caption" data-start="${requireNarrationStart(narration, scene.id)}" data-duration="${requireNarrationDuration(narration, scene.id)}">${escapeHtml(narration.text)}</p>
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

function indexNarrationBySceneId(narration: Narration): Map<string, Narration['segments'][number]> {
  const indexed = new Map<string, Narration['segments'][number]>()

  for (const [index, segment] of narration.segments.entries()) {
    if (segment.sceneId === undefined || segment.sceneId.trim() === '') {
      throw new Error(`HyperFrames narration segment ${index + 1} is missing sceneId; no scene-index narration fallback is allowed.`)
    }

    if (indexed.has(segment.sceneId)) {
      throw new Error(`HyperFrames narration contains duplicate sceneId "${segment.sceneId}".`)
    }

    indexed.set(segment.sceneId, segment)
  }

  return indexed
}

function resolveNarrationForScene(
  narrationBySceneId: Map<string, Narration['segments'][number]>,
  sceneId: string,
): Narration['segments'][number] {
  const narration = narrationBySceneId.get(sceneId)

  if (narration === undefined) {
    throw new Error(`HyperFrames scene "${sceneId}" is missing a matching LLM-authored narration segment; no scene-index narration fallback is allowed.`)
  }

  return narration
}

function resolveSceneNarrationText(scene: Storyboard['scenes'][number], narration: Narration['segments'][number]): string {
  const text = narration.text.trim()

  if (text === '') {
    throw new Error(`HyperFrames scene "${scene.id}" is missing LLM-authored narration text.`)
  }

  return text
}

function requireNarrationStart(narration: Narration['segments'][number], sceneId: string): number {
  if (narration.start === undefined) {
    throw new Error(`HyperFrames narration for scene "${sceneId}" is missing start; no scene timing fallback is allowed.`)
  }

  return narration.start
}

function requireNarrationDuration(narration: Narration['segments'][number], sceneId: string): number {
  if (narration.duration === undefined) {
    throw new Error(`HyperFrames narration for scene "${sceneId}" is missing duration; no scene timing fallback is allowed.`)
  }

  return narration.duration
}

function createEvidenceRefItems(scene: Storyboard['scenes'][number]): string[] {
  return scene.evidence.map((item) => `${item.type}:${item.ref}`)
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

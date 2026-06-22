import type {Narration, QualityIssueSeverity, Storyboard, Timeline} from '@video-agent/ir'

import {QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY} from '@video-agent/ir'
import {readFile, stat} from 'node:fs/promises'

export interface HyperframesTemplateQualityResult {
  errors: number
  issues: HyperframesTemplateIssue[]
  ok: boolean
  warnings: number
}

export interface HyperframesTemplateIssue {
  code: string
  message: string
  severity: QualityIssueSeverity
}

export interface CheckHyperframesTemplateInput {
  entryHtml: string
  narration: Narration
  planPath: string
  storyboard: Storyboard
  stylesPath: string
  timeline: Timeline
}

export async function checkHyperframesTemplateProject(input: CheckHyperframesTemplateInput): Promise<HyperframesTemplateQualityResult> {
  const issues: HyperframesTemplateIssue[] = []
  const [html, styles, plan] = await Promise.all([
    readRequiredText(input.entryHtml, 'hyperframes.template.entry_missing', 'HyperFrames entry HTML is missing.', issues),
    readRequiredText(input.stylesPath, 'hyperframes.template.styles_missing', 'HyperFrames stylesheet is missing.', issues),
    readRequiredJson(input.planPath, 'hyperframes.template.plan_missing', 'HyperFrames render plan is missing.', issues),
  ])

  if (html !== undefined) {
    validateHtml(html, input, issues)
  }

  if (styles !== undefined) {
    validateStyles(styles, issues)
  }

  if (plan !== undefined) {
    validateRenderPlan(plan, input, issues)
  }

  return summarizeIssues(issues)
}

async function readRequiredText(path: string, code: string, message: string, issues: HyperframesTemplateIssue[]): Promise<string | undefined> {
  try {
    const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])

    if (info.size === 0 || content.trim().length === 0) {
      issues.push({
        code: code.replace('_missing', '_empty'),
        message: message.replace('missing', 'empty'),
        severity: 'error',
      })
    }

    return content
  } catch (error) {
    issues.push({
      code,
      message: `${message} ${formatError(error)}`,
      severity: 'error',
    })

    return undefined
  }
}

async function readRequiredJson(path: string, code: string, message: string, issues: HyperframesTemplateIssue[]): Promise<unknown> {
  const content = await readRequiredText(path, code, message, issues)

  if (content === undefined) {
    return undefined
  }

  try {
    return JSON.parse(content) as unknown
  } catch (error) {
    issues.push({
      code: 'hyperframes.template.plan_invalid_json',
      message: `HyperFrames render plan is not valid JSON. ${formatError(error)}`,
      severity: 'error',
    })

    return undefined
  }
}

function validateHtml(html: string, input: CheckHyperframesTemplateInput, issues: HyperframesTemplateIssue[]): void {
  if (!html.includes('id="render-plan"')) {
    issues.push({
      code: 'hyperframes.template.plan_script_missing',
      message: 'Entry HTML does not embed a render-plan script tag.',
      severity: 'error',
    })
  }

  if (!html.includes('href="./styles.css"')) {
    issues.push({
      code: 'hyperframes.template.stylesheet_missing',
      message: 'Entry HTML does not reference styles.css.',
      severity: 'error',
    })
  }

  if (!html.includes(`data-duration="${input.timeline.duration}"`)) {
    issues.push({
      code: 'hyperframes.template.duration_mismatch',
      message: 'Entry HTML stage duration does not match the timeline duration.',
      severity: 'error',
    })
  }

  const sceneCount = countMatches(html, 'class="scene"')
  if (sceneCount !== input.storyboard.scenes.length) {
    issues.push({
      code: 'hyperframes.template.scene_count_mismatch',
      message: `Entry HTML contains ${sceneCount} scene(s), expected ${input.storyboard.scenes.length}.`,
      severity: 'error',
    })
  }

  const expectedCaptions = input.narration.segments.length
  const captionCount = countMatches(html, 'class="caption"')
  if (captionCount !== expectedCaptions) {
    issues.push({
      code: 'hyperframes.template.caption_count_mismatch',
      message: `Entry HTML contains ${captionCount} caption(s), expected ${expectedCaptions}.`,
      severity: 'warning',
    })
  }
}

function validateStyles(styles: string, issues: HyperframesTemplateIssue[]): void {
  for (const selector of ['.stage', '.scene']) {
    if (!styles.includes(selector)) {
      issues.push({
        code: 'hyperframes.template.selector_missing',
        message: `Stylesheet does not define ${selector}.`,
        severity: 'error',
      })
    }
  }

  if (!styles.includes('aspect-ratio')) {
    issues.push({
      code: 'hyperframes.template.aspect_ratio_missing',
      message: 'Stylesheet does not define a stable aspect ratio for the render stage.',
      severity: 'warning',
    })
  }
}

function validateRenderPlan(plan: unknown, input: CheckHyperframesTemplateInput, issues: HyperframesTemplateIssue[]): void {
  if (!isRecord(plan)) {
    issues.push({
      code: 'hyperframes.template.plan_not_object',
      message: 'HyperFrames render plan is not an object.',
      severity: 'error',
    })

    return
  }

  if (plan.duration !== input.timeline.duration) {
    issues.push({
      code: 'hyperframes.template.plan_duration_mismatch',
      message: 'Render plan duration does not match the timeline duration.',
      severity: 'error',
    })
  }

  const planScenes = isRecord(plan.storyboard) && Array.isArray(plan.storyboard.scenes) ? plan.storyboard.scenes : undefined
  if (planScenes === undefined || planScenes.length !== input.storyboard.scenes.length) {
    issues.push({
      code: 'hyperframes.template.plan_scene_count_mismatch',
      message: `Render plan scene count does not match the storyboard scene count of ${input.storyboard.scenes.length}.`,
      severity: 'error',
    })
  }

  const planNarration = isRecord(plan.narration) && Array.isArray(plan.narration.segments) ? plan.narration.segments : undefined
  if (planNarration === undefined || planNarration.length !== input.narration.segments.length) {
    issues.push({
      code: 'hyperframes.template.plan_narration_count_mismatch',
      message: `Render plan narration segment count does not match the narration segment count of ${input.narration.segments.length}.`,
      severity: 'error',
    })
  }

  if (!isRecord(plan.timeline) || plan.timeline.duration !== input.timeline.duration) {
    issues.push({
      code: 'hyperframes.template.plan_timeline_mismatch',
      message: 'Render plan timeline does not match the project timeline.',
      severity: 'error',
    })
  }
}

function summarizeIssues(issues: HyperframesTemplateIssue[]): HyperframesTemplateQualityResult {
  const errors = issues.filter((issue) => issue.severity === QUALITY_ERROR_SEVERITY).length
  const warnings = issues.filter((issue) => issue.severity === QUALITY_WARNING_SEVERITY).length

  return {
    errors,
    issues,
    ok: errors === 0,
    warnings,
  }
}

function countMatches(value: string, pattern: string): number {
  return value.split(pattern).length - 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

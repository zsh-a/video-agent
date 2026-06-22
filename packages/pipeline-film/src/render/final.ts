import type {QualityIssue} from '@video-agent/quality'

import {runFfmpeg} from '@video-agent/media'
import {QUALITY_WARNING_SEVERITY, countQualityIssues} from '@video-agent/quality'
import {findCjkSubtitleFont, findCjkSubtitleFontPath} from '@video-agent/runtime'
import {mkdir, readFile, rename} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {containsCjk, roundSeconds} from '../shared/utils.js'
import {unlinkIfExists} from './utils.js'

export async function renderFinalFilmVideo(options: {
  audioMixPath: string
  editedSourcePath: string
  outputPath: string
  subtitlePath: string
}): Promise<{subtitleBurnInIssue?: QualityIssue; subtitlesBurned: boolean}> {
  await mkdir(resolve(options.outputPath, '..'), {recursive: true})
  const subtitleBurnInIssue = await getSubtitleBurnInReadinessIssue(options.subtitlePath)

  if (subtitleBurnInIssue !== undefined) {
    await renderFinalFilmVideoAttempt(options, false)

    return {
      subtitleBurnInIssue,
      subtitlesBurned: false,
    }
  }

  try {
    await renderFinalFilmVideoAttempt(options, 'subtitles')

    return {subtitlesBurned: true}
  } catch (error) {
    if (!isMissingSubtitleFilterError(error)) {
      throw error
    }

    try {
      await renderFinalFilmVideoAttempt(options, 'drawtext')

      return {subtitlesBurned: true}
    } catch (drawtextError) {
      if (!isMissingDrawtextFilterError(drawtextError)) {
        throw drawtextError
      }
    }

    await renderFinalFilmVideoAttempt(options, false)

    return {
      subtitleBurnInIssue: {
        code: 'subtitle.render.filters_unavailable',
        message: 'The ffmpeg subtitles and drawtext filters are unavailable; subtitles were written as a sidecar file but not burned into final.mp4.',
        severity: QUALITY_WARNING_SEVERITY,
      },
      subtitlesBurned: false,
    }
  }
}

export function withSubtitleBurnInWarning<T extends {errors: number; issues: QualityIssue[]; warnings: number}>(quality: T, issue: QualityIssue | undefined): T {
  if (issue === undefined) {
    return quality
  }

  const issues = [
    ...quality.issues,
    issue,
  ]

  return {
    ...quality,
    ...countQualityIssues(issues),
    issues,
  }
}

async function renderFinalFilmVideoAttempt(options: {
  audioMixPath: string
  editedSourcePath: string
  outputPath: string
  subtitlePath: string
}, subtitleMode: false | 'drawtext' | 'subtitles'): Promise<void> {
  const tempOutputPath = `${options.outputPath}.tmp-${process.pid}-${Date.now()}.mp4`
  const renderOptions = {
    ...options,
    outputPath: tempOutputPath,
  }

  try {
    await runFfmpeg(await buildFinalFilmRenderArgs(renderOptions, subtitleMode))
    await rename(tempOutputPath, options.outputPath)
  } catch (error) {
    await unlinkIfExists(tempOutputPath)
    throw error
  }
}

async function getSubtitleBurnInReadinessIssue(subtitlePath: string): Promise<QualityIssue | undefined> {
  const content = await readFile(subtitlePath, 'utf8')

  if (!containsCjk(content)) {
    return undefined
  }

  if (await findCjkSubtitleFontPath() !== undefined) {
    return undefined
  }

  return {
    code: 'subtitle.render.cjk_font_unavailable',
    message: 'No reliable CJK subtitle font was found; subtitles were written as a sidecar file but not burned into final.mp4.',
    severity: QUALITY_WARNING_SEVERITY,
  }
}

async function buildFinalFilmRenderArgs(options: {
  audioMixPath: string
  editedSourcePath: string
  outputPath: string
  subtitlePath: string
}, subtitleMode: false | 'drawtext' | 'subtitles'): Promise<string[]> {
  const videoFilter = subtitleMode === 'subtitles'
    ? await buildSubtitleBurnInFilter(options.subtitlePath)
    : subtitleMode === 'drawtext'
      ? await buildDrawtextSubtitleFilter(options.subtitlePath)
      : undefined
  const videoCodecArgs = videoFilter !== undefined
    ? [
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-pix_fmt',
        'yuv420p',
      ]
    : [
        '-c:v',
        'copy',
      ]

  return [
    '-y',
    '-i',
    options.editedSourcePath,
    '-i',
    options.audioMixPath,
    ...(videoFilter === undefined ? [] : ['-vf', videoFilter]),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    ...videoCodecArgs,
    '-c:a',
    'aac',
    '-shortest',
    options.outputPath,
  ]
}

async function buildSubtitleBurnInFilter(subtitlePath: string): Promise<string> {
  const font = await findCjkSubtitleFont()
  const style = [
    `FontName=${font?.family ?? 'Noto Sans CJK SC'}`,
    'FontSize=18',
    'PrimaryColour=&H00FFFFFF',
    'OutlineColour=&H90000000',
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    'Alignment=2',
    'MarginV=80',
  ].join(',')
  const fontsDir = font === undefined ? undefined : dirname(font.path)

  return [
    `subtitles=filename='${escapeSubtitleFilterPath(subtitlePath)}'`,
    ...(fontsDir === undefined ? [] : [`fontsdir='${escapeSubtitleFilterPath(fontsDir)}'`]),
    'charenc=UTF-8',
    `force_style='${escapeSubtitleFilterValue(style)}'`,
  ].join(':')
}

function isMissingSubtitleFilterError(error: unknown): boolean {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.includes("No such filter: 'subtitles'")
}

function isMissingDrawtextFilterError(error: unknown): boolean {
  return error instanceof Error && 'stderr' in error && typeof error.stderr === 'string' && error.stderr.includes("No such filter: 'drawtext'")
}

async function buildDrawtextSubtitleFilter(subtitlePath: string): Promise<string> {
  const fontPath = await findCjkSubtitleFontPath()
  const cues = parseSrtSubtitleCues(await readFile(subtitlePath, 'utf8'))

  if (cues.length === 0) {
    return 'null'
  }

  return cues.map((cue) => {
    const options = [
      ...(fontPath === undefined ? [] : [`fontfile='${escapeDrawtextValue(fontPath)}'`]),
      `text='${escapeDrawtextValue(cue.text)}'`,
      'x=(w-text_w)/2',
      'y=h-160',
      'fontsize=36',
      'fontcolor=white',
      'borderw=3',
      'bordercolor=black',
      `enable='between(t,${roundSeconds(cue.start)},${roundSeconds(cue.end)})'`,
    ]

    return `drawtext=${options.join(':')}`
  }).join(',')
}

function parseSrtSubtitleCues(content: string): Array<{end: number; start: number; text: string}> {
  return content
    .split(/\n\s*\n/u)
    .flatMap((block) => {
      const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
      const timing = lines.find((line) => line.includes('-->'))

      if (timing === undefined) {
        return []
      }

      const [startText, endText] = timing.split('-->').map((value) => value.trim())
      const start = parseSrtTime(startText)
      const end = parseSrtTime(endText)
      const text = lines.slice(lines.indexOf(timing) + 1).join('\n').trim()

      if (start === undefined || end === undefined || end <= start || text === '') {
        return []
      }

      return [{end, start, text}]
    })
}

function parseSrtTime(value: string | undefined): number | undefined {
  const match = value?.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/u)

  if (match === undefined || match === null) {
    return undefined
  }

  const [, hours, minutes, seconds, milliseconds] = match

  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(milliseconds) / 1000
}

function escapeDrawtextValue(value: string): string {
  return value
    .replaceAll('\\', String.raw`\\`)
    .replaceAll("'", String.raw`\'`)
    .replaceAll(':', String.raw`\:`)
    .replaceAll(',', String.raw`\,`)
    .replaceAll('%', String.raw`\%`)
    .replaceAll('\n', String.raw`\n`)
}

function escapeSubtitleFilterPath(path: string): string {
  return path.replaceAll('\\', String.raw`\\`).replaceAll(':', String.raw`\:`).replaceAll("'", String.raw`\'`)
}

function escapeSubtitleFilterValue(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)
}

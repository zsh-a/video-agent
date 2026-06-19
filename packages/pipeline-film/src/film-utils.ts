import type {MediaStream, SourceManifest} from '@video-agent/ir'

import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {isAbsolute, relative, resolve, sep} from 'node:path'

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function rangesOverlap(left: [number, number], right: [number, number]): boolean {
  return left[0] < right[1] && right[0] < left[1]
}

export function rangeOverlapSeconds(left: [number, number], right: [number, number]): number {
  return Math.max(0, Math.min(left[1], right[1]) - Math.max(left[0], right[0]))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function isChineseLanguage(language: string): boolean {
  return language.toLowerCase().startsWith('zh')
}

export function containsCjk(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}

export function resolveProjectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path)
}

export function toProjectReference(projectDir: string, path: string): string {
  const name = relative(projectDir, path)

  if (name !== '' && name !== '..' && !name.startsWith(`..${sep}`) && !isAbsolute(name)) {
    return name.split(sep).join('/')
  }

  return path
}

export function maxStreamDuration(streams: MediaStream[]): number | undefined {
  const durations = streams
    .map((stream) => stream.duration)
    .filter((duration): duration is number => duration !== undefined)

  return durations.length === 0 ? undefined : Math.max(...durations)
}

export function getOrientation(video: MediaStream | undefined): SourceManifest['orientation'] {
  if (video?.width === undefined || video.height === undefined) {
    return 'unknown'
  }

  if (video.width > video.height) {
    return 'landscape'
  }

  if (video.height > video.width) {
    return 'portrait'
  }

  return 'square'
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)

  for await (const chunk of stream) {
    hash.update(chunk)
  }

  return hash.digest('hex')
}

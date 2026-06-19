import type {TimedDeck} from '@video-agent/ir'
import type {SubtitleQualityResult} from '@video-agent/quality'
import type {ProjectWorkspace} from '@video-agent/runtime'

import {NarrationSchema} from '@video-agent/ir'
import {probeMedia, runFfmpeg} from '@video-agent/media'
import {checkRenderedMedia, checkSrtSubtitles, createRenderedMediaProbeFailure} from '@video-agent/quality'
import {narrationToSrt, narrationToSrtCues} from '@video-agent/renderer-ffmpeg'
import {bunFile, bunWrite} from '@video-agent/runtime'
import {resolve} from 'node:path'

import {toProjectPath} from '../../project/paths.js'

export async function writeDeckSubtitles(workspace: ProjectWorkspace, timedDeck: TimedDeck): Promise<{
  outputPath: string
  quality: SubtitleQualityResult
}> {
  const narration = NarrationSchema.parse(await workspace.store.readJson('narration.json'))
  const outputPath = resolve(workspace.rendersDir, 'subtitles.srt')
  const cues = narrationToSrtCues(narration)

  await bunWrite(outputPath, narrationToSrt(narration))
  await workspace.store.writeJson('subtitles.json', {
    cues: cues.length,
    format: 'srt' as const,
    generatedAt: new Date().toISOString(),
    path: toProjectPath(workspace.projectDir, outputPath),
    version: 1 as const,
  })

  return {
    outputPath,
    quality: checkSrtSubtitles(await bunFile(outputPath).text(), {
      maxEnd: timedDeck.timings.at(-1)?.end ?? 0,
    }),
  }
}

export async function renderDeckFrameSequenceVideo(framePattern: string, fps: number, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-framerate',
    String(fps),
    '-i',
    framePattern,
    '-an',
    '-vf',
    'format=yuv420p',
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-movflags',
    '+faststart',
    outputPath,
  ])
}

export async function muxDeckFinalVideo(input: {
  audioPath: string
  outputPath: string
  silentVideoPath: string
  subtitlePath: string
}): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    input.silentVideoPath,
    '-i',
    input.audioPath,
    '-i',
    input.subtitlePath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-map',
    '2:0',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-c:s',
    'mov_text',
    '-shortest',
    '-movflags',
    '+faststart',
    input.outputPath,
  ])
}

export async function inspectDeckRenderedOutput(outputPath: string, options: {expectedDuration: number}) {
  try {
    return checkRenderedMedia(await probeMedia(outputPath), {
      expectAudio: true,
      expectedDuration: options.expectedDuration,
    })
  } catch (error) {
    return createRenderedMediaProbeFailure(error instanceof Error ? error.message : String(error))
  }
}

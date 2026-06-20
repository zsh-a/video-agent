import type {TTSSegment} from '@video-agent/providers'

import {runFfmpeg} from '@video-agent/media'
import {resolve} from 'node:path'

export async function convertDeckSourceAudio(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '48000',
    '-ac',
    '2',
    outputPath,
  ])
}

export async function renderDeckVoiceover(projectDir: string, ttsSegments: TTSSegment[], outputPath: string): Promise<void> {
  if (ttsSegments.length === 0) {
    await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=48000',
      '-t',
      '0.1',
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return
  }

  const inputArgs = ttsSegments.flatMap((segment) => ['-i', resolve(projectDir, segment.path)])
  const concatInputs = ttsSegments.map((_, index) => `[${index}:a]`).join('')

  await runFfmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex',
    `${concatInputs}concat=n=${ttsSegments.length}:v=0:a=1[concat];[concat]loudnorm=I=-18:TP=-2:LRA=11[aout]`,
    '-map',
    '[aout]',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ])
}

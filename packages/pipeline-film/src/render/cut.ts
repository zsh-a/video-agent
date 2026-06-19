import type {ClipPlan} from '@video-agent/ir'

import {runFfmpeg} from '@video-agent/media'

export async function renderCutVideo(clipPlan: ClipPlan, outputPath: string, includeAudio: boolean): Promise<void> {
  if (clipPlan.clips.length === 0) {
    throw new Error('Cannot render cut because clip-plan.json contains no clips.')
  }

  const videoFilterParts = clipPlan.clips.map((clip, index) => {
    const [start, end] = clip.sourceRange

    return `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`
  })

  if (!includeAudio) {
    const concatInputs = clipPlan.clips.map((_, index) => `[v${index}]`).join('')
    const filter = `${videoFilterParts.join(';')};${concatInputs}concat=n=${clipPlan.clips.length}:v=1:a=0[outv]`

    await runFfmpeg([
      '-y',
      '-i',
      clipPlan.source,
      '-filter_complex',
      filter,
      '-map',
      '[outv]',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      outputPath,
    ])
    return
  }

  const audioFilterParts = clipPlan.clips.map((clip, index) => {
    const [start, end] = clip.sourceRange

    return `[0:a:0]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`
  })
  const concatInputs = clipPlan.clips.map((_, index) => `[v${index}][a${index}]`).join('')
  const filter = `${[...videoFilterParts, ...audioFilterParts].join(';')};${concatInputs}concat=n=${clipPlan.clips.length}:v=1:a=1[outv][outa]`

  await runFfmpeg([
    '-y',
    '-i',
    clipPlan.source,
    '-filter_complex',
    filter,
    '-map',
    '[outv]',
    '-map',
    '[outa]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outputPath,
  ])
}

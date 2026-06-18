import {expect} from '#test/expect'

import {buildFfmpegRenderArgs} from '../../../packages/renderer-ffmpeg/src/render.js'

describe('ffmpeg render args', () => {
  it('builds args for subtitles and mixed voiceover audio', () => {
    const args = buildFfmpegRenderArgs(
      {
        duration: 5,
        fps: 30,
        items: [
          {
            duration: 5,
            id: 'video-1',
            source: '/tmp/input.mp4',
            sourceRange: [2, 7],
            start: 0,
            track: 'video',
          },
        ],
        version: 1,
      },
      {
        audio: {
          sourceAudioPath: '/tmp/source.wav',
          voiceovers: [
            {
              duration: 2,
              path: '/tmp/voice.wav',
              start: 1.25,
            },
          ],
        },
        outputPath: '/tmp/final.mp4',
        subtitlePath: '/tmp/subtitles.srt',
      },
    )

    expect(args).to.include.members([
      '-filter_complex',
      '-map',
      '0:v:0',
      '[aout]',
      '-vf',
      'subtitles=/tmp/subtitles.srt',
      '-c:a',
      'aac',
    ])
    expect(args).to.deep.include('-shortest')
    expect(args.join(' ')).to.contain('[1:a]volume=0.35[source0]')
    expect(args.join(' ')).to.contain('[2:a]atrim=duration=2,adelay=1250:all=1,volume=1[voice1]')
    expect(args.join(' ')).to.contain('amix=inputs=2')
  })

  it('builds sidechain ducking args when enabled', () => {
    const args = buildFfmpegRenderArgs(
      {
        duration: 5,
        fps: 30,
        items: [
          {
            duration: 5,
            id: 'video-1',
            source: '/tmp/input.mp4',
            start: 0,
            track: 'video',
          },
        ],
        version: 1,
      },
      {
        audio: {
          ducking: {
            attackMs: 3,
            enabled: true,
            ratio: 10,
            releaseMs: 180,
            threshold: 0.02,
          },
          sourceAudioPath: '/tmp/source.wav',
          sourceVolume: 0.8,
          voiceovers: [
            {
              duration: 2,
              path: '/tmp/voice.wav',
              start: 1,
            },
          ],
          voiceoverVolume: 1.2,
        },
        outputPath: '/tmp/final.mp4',
      },
    )
    const joined = args.join(' ')

    expect(joined).to.contain('[1:a]volume=0.8[source0]')
    expect(joined).to.contain('[2:a]atrim=duration=2,adelay=1000:all=1,volume=1.2[voice1]')
    expect(joined).to.contain('[voice1]anull[voicebus]')
    expect(joined).to.contain('[voicebus]apad,atrim=duration=5,asplit=2[duckkey][voicemix]')
    expect(joined).to.contain('[source0][duckkey]sidechaincompress=threshold=0.02:ratio=10:attack=3:release=180[ducked]')
    expect(joined).to.contain('[ducked][voicemix]amix=inputs=2')
  })
})

import {expect} from '#test/expect'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {extractAudio, parseAudioVolumeOutput, parseFfmpegProgressOutput, parseVideoBlackDetectOutput} from '../../../packages/media/src/ffmpeg.js'
import {runProcess} from '../../../packages/media/src/process.js'

describe('ffmpeg media helpers', () => {
  it('parses ffmpeg progress records', () => {
    const records = parseFfmpegProgressOutput([
      'frame=10',
      'out_time_ms=1000000',
      'progress=continue',
      'frame=20',
      'out_time_ms=2000000',
      'progress=end',
      '',
    ].join('\n'))

    expect(records).to.deep.equal([
      {
        frame: '10',
        out_time_ms: '1000000',
        progress: 'continue',
      },
      {
        frame: '20',
        out_time_ms: '2000000',
        progress: 'end',
      },
    ])
  })

  it('parses ffmpeg volumedetect output', () => {
    const result = parseAudioVolumeOutput(
      '/tmp/final.mp4',
      [
        '[Parsed_volumedetect_0 @ 0x123] n_samples: 96000',
        '[Parsed_volumedetect_0 @ 0x123] mean_volume: -21.4 dB',
        '[Parsed_volumedetect_0 @ 0x123] max_volume: -1.2 dB',
      ].join('\n'),
    )

    expect(result.inputPath).to.equal('/tmp/final.mp4')
    expect(result.meanVolumeDb).to.equal(-21.4)
    expect(result.maxVolumeDb).to.equal(-1.2)
    expect(result.raw).to.contain('mean_volume')
    expect(result.version).to.equal(1)
  })

  it('parses ffmpeg blackdetect output', () => {
    const result = parseVideoBlackDetectOutput(
      '/tmp/final.mp4',
      [
        '[blackdetect @ 0x123] black_start:0 black_end:0.4 black_duration:0.4',
        '[blackdetect @ 0x123] black_start:1.2 black_end:1.5 black_duration:0.3',
      ].join('\n'),
      2,
    )

    expect(result).to.include({
      blackDuration: 0.7,
      blackRatio: 0.35,
      duration: 2,
      inputPath: '/tmp/final.mp4',
      version: 1,
    })
    expect(result.blackSegments).to.deep.equal([
      {
        duration: 0.4,
        end: 0.4,
        start: 0,
      },
      {
        duration: 0.3,
        end: 1.5,
        start: 1.2,
      },
    ])
  })

  it('extracts ASR audio as 24 kHz mono PCM wav when media tools are available', async () => {
    if (!(await hasMediaTools())) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'video-agent-extract-audio-'))
    const inputPath = join(root, 'input.wav')
    const outputPath = join(root, 'source.wav')

    try {
      await runProcess([
        'ffmpeg',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:sample_rate=48000',
        '-t',
        '1',
        '-ac',
        '2',
        inputPath,
      ])

      await extractAudio(inputPath, outputPath)

      const stream = await probeFirstAudioStream(outputPath)

      expect(stream).to.deep.include({
        bits_per_sample: 16,
        channels: 1,
        codec_name: 'pcm_s16le',
        sample_rate: '24000',
      })
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function hasMediaTools(): Promise<boolean> {
  const [ffmpeg, ffprobe] = await Promise.all([runProcess(['ffmpeg', '-version']), runProcess(['ffprobe', '-version'])])

  return ffmpeg.code === 0 && ffprobe.code === 0
}

async function probeFirstAudioStream(path: string): Promise<Record<string, unknown>> {
  const result = await runProcess([
    'ffprobe',
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=codec_name,sample_rate,channels,bits_per_sample',
    '-of',
    'json',
    path,
  ])

  expect(result.code).to.equal(0)

  const parsed = JSON.parse(result.stdout) as {streams?: Record<string, unknown>[]}

  return parsed.streams?.[0] ?? {}
}

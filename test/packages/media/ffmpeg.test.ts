import {expect} from '#test/expect'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {extractAudio, parseAudioVolumeOutput, parseFfmpegProgressOutput, parseVideoBlackDetectOutput} from '../../../packages/media/src/ffmpeg.js'
import {parseFfprobeMediaInfo} from '../../../packages/media/src/ffprobe.js'
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

  it('rejects invalid blackdetect durations instead of omitting black ratio', () => {
    expect(() => parseVideoBlackDetectOutput('/tmp/final.mp4', '', 0))
      .to.throw('no black-ratio omission fallback is allowed')
  })

  it('parses ffprobe JSON through a strict media boundary schema', () => {
    const result = parseFfprobeMediaInfo('/tmp/input.mp4', JSON.stringify({
      format: {
        bit_rate: '96000',
        duration: '12.5',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        size: '12345',
      },
      streams: [
        {
          avg_frame_rate: '30000/1001',
          codec_name: 'h264',
          codec_type: 'video',
          duration: '12.5',
          height: 1080,
          index: 0,
          width: 1920,
        },
        {
          codec_name: 'aac',
          codec_type: 'audio',
          duration: 'N/A',
          index: 1,
          r_frame_rate: '0/0',
        },
      ],
    }))

    expect(result).to.deep.include({
      bitrate: 96000,
      duration: 12.5,
      formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
      inputPath: '/tmp/input.mp4',
      size: 12345,
      version: 1,
    })
    expect(result.streams).to.deep.equal([
      {
        codecName: 'h264',
        duration: 12.5,
        fps: 30000 / 1001,
        height: 1080,
        index: 0,
        type: 'video',
        width: 1920,
      },
      {
        codecName: 'aac',
        index: 1,
        type: 'audio',
      },
    ])
  })

  it('rejects malformed ffprobe JSON instead of inferring media info shape', () => {
    expect(() => parseFfprobeMediaInfo('/tmp/input.mp4', '{"format":'))
      .to.throw('ffprobe returned invalid JSON; no media-info shape inference fallback is allowed')
    expect(() => parseFfprobeMediaInfo('/tmp/input.mp4', '{"streams":{}}'))
      .to.throw('ffprobe JSON has invalid shape; no media-info shape inference fallback is allowed')
    expect(() => parseFfprobeMediaInfo('/tmp/input.mp4', '{"streams":[{"codec_type":"video"}]}'))
      .to.throw('ffprobe JSON has invalid shape; no media-info shape inference fallback is allowed')
    expect(() => parseFfprobeMediaInfo('/tmp/input.mp4', '{"format":{"duration":"later"},"streams":[]}'))
      .to.throw('ffprobe format duration must be a finite numeric string')
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

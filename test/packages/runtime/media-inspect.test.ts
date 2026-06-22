import {expect} from '#test/expect'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runProcess} from '../../../packages/media/src/process.js'
import {ARTIFACT_MANIFEST_NAME, MEDIA_INFO_ARTIFACT_NAME} from '../../../packages/runtime/src/artifacts/artifact-names.js'
import {inspectMediaProject} from '../../../packages/runtime/src/project/media-inspect.js'

describe('media inspect project', () => {
  it('probes media through runtime and writes media-info artifacts', async () => {
    if (!(await hasMediaTools())) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'video-agent-media-inspect-'))
    const inputPath = join(root, 'input.wav')

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
        inputPath,
      ])

      const result = await inspectMediaProject(inputPath, {
        projectId: 'inspect-demo',
        workspaceDir: root,
      })
      const mediaInfo = JSON.parse(await readFile(result.artifactPath, 'utf8')) as {
        duration?: number
        inputPath: string
        streams: unknown[]
        version: number
      }
      const manifest = JSON.parse(await readFile(join(root, 'projects', 'inspect-demo', 'artifacts', ARTIFACT_MANIFEST_NAME), 'utf8')) as {
        artifacts: Array<{name: string}>
      }

      expect(result.projectId).to.equal('inspect-demo')
      expect(result.inputPath).to.equal(inputPath)
      expect(result.duration ?? 0).to.be.greaterThan(0)
      expect(result.streams).to.be.greaterThan(0)
      expect(mediaInfo).to.include({inputPath, version: 1})
      expect(mediaInfo.streams).to.have.length(result.streams)
      expect(manifest.artifacts.map((artifact) => artifact.name)).to.include(MEDIA_INFO_ARTIFACT_NAME)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function hasMediaTools(): Promise<boolean> {
  const [ffmpeg, ffprobe] = await Promise.all([runProcess(['ffmpeg', '-version']), runProcess(['ffprobe', '-version'])])

  return ffmpeg.code === 0 && ffprobe.code === 0
}

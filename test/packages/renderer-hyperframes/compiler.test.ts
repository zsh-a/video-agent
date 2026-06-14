import {expect} from 'chai'
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeHyperframesProject} from '../../../packages/renderer-hyperframes/src/compiler.js'

describe('hyperframes compiler', () => {
  it('writes a renderable html project from IR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-hyperframes-'))

    try {
      const result = await writeHyperframesProject({
        narration: {
          language: 'zh-CN',
          segments: [
            {
              duration: 1,
              id: 'narration-1',
              start: 0,
              text: 'hello',
            },
          ],
          version: 1,
        },
        outputDir: root,
        storyboard: {
          language: 'zh-CN',
          scenes: [
            {
              duration: 1,
              evidence: [],
              id: 'scene-1',
              narration: 'hello',
              start: 0,
              visualStyle: 'documentary',
            },
          ],
          targetPlatform: 'generic',
          version: 1,
        },
        timeline: {
          duration: 1,
          fps: 30,
          items: [],
          version: 1,
        },
      })

      expect(await fileSize(result.entryHtml)).to.be.greaterThan(0)
      expect(await fileSize(result.planPath)).to.be.greaterThan(0)
      expect(await readFile(result.entryHtml, 'utf8')).to.contain('data-duration="1"')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

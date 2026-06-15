import {expect} from '#test/expect'
import {readText, writeText} from '#test/fs'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeHyperframesProject} from '../../../packages/renderer-hyperframes/src/compiler.js'
import {checkHyperframesTemplateProject} from '../../../packages/renderer-hyperframes/src/template-quality.js'

describe('hyperframes compiler', () => {
  it('writes a renderable html project from IR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-hyperframes-'))
    const narration = {
      language: 'zh-CN',
      segments: [
        {
          duration: 1,
          id: 'narration-1',
          start: 0,
          text: 'hello',
        },
      ],
      version: 1 as const,
    }
    const storyboard = {
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
      targetPlatform: 'generic' as const,
      version: 1 as const,
    }
    const timeline = {
      duration: 1,
      fps: 30,
      items: [],
      version: 1 as const,
    }

    try {
      const result = await writeHyperframesProject({
        narration,
        outputDir: root,
        storyboard,
        timeline,
      })

      expect(await fileSize(result.entryHtml)).to.be.greaterThan(0)
      expect(await fileSize(result.planPath)).to.be.greaterThan(0)
      expect(await readText(result.entryHtml)).to.contain('data-duration="1"')
      expect(await checkHyperframesTemplateProject({
        entryHtml: result.entryHtml,
        narration,
        planPath: result.planPath,
        storyboard,
        stylesPath: result.stylesPath,
        timeline,
      })).to.deep.equal({
        errors: 0,
        issues: [],
        ok: true,
        warnings: 0,
      })

      await writeText(result.entryHtml, '<main class="stage" data-duration="2"></main>')
      const quality = await checkHyperframesTemplateProject({
        entryHtml: result.entryHtml,
        narration,
        planPath: result.planPath,
        storyboard,
        stylesPath: result.stylesPath,
        timeline,
      })

      expect(quality.ok).to.equal(false)
      expect(quality.issues.map((issue) => issue.code)).to.include.members([
        'hyperframes.template.duration_mismatch',
        'hyperframes.template.plan_script_missing',
        'hyperframes.template.scene_count_mismatch',
        'hyperframes.template.stylesheet_missing',
      ])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

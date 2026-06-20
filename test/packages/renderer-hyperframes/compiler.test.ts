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
          sceneId: 'scene-1',
          start: 0,
          text: '第 1 页：介绍开源下载器。强调复制链接、选择画质、下载记录这三个要点。',
        },
        {
          duration: 1,
          id: 'narration-2',
          sceneId: 'scene-2',
          start: 1,
          text: '第 2 页：Seal 已获得 1.3 万星标。支持下载视频和音频。',
        },
      ],
      version: 1 as const,
    }
    const storyboard = {
      language: 'zh-CN',
      scenes: [
        {
          duration: 1,
          evidence: [
            {
              ref: 'chunks/000/transcript.json',
              text: 'Open source app walkthrough evidence.',
              type: 'asr' as const,
            },
          ],
          id: 'scene-1',
          narration: '第 1 页：介绍开源下载器。',
          start: 0,
          visualStyle: 'slide_explainer',
        },
        {
          duration: 1,
          evidence: [
            {
              ref: 'chunks/000/transcript.json',
              text: 'Second slide evidence.',
              type: 'asr' as const,
            },
          ],
          id: 'scene-2',
          narration: '第 2 页：Seal 已获得 1.3 万星标。支持下载视频和音频。',
          start: 1,
          visualStyle: 'slide_explainer',
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
      const html = await readText(result.entryHtml)
      const styles = await readText(result.stylesPath)

      expect(html).to.contain('data-duration="1"')
      expect(html).to.contain('Slide 1')
      expect(html).to.contain('Slide 2')
      expect(html).to.contain('data-start="1"')
      expect(html).to.contain('scene__narration')
      expect(html).to.contain('slide explainer')
      expect(html).to.contain('介绍开源下载器')
      expect(html).to.contain('Seal 已获得 1.3 万星标')
      expect(html).to.contain('asr:chunks/000/transcript.json')
      expect(html).not.include('<p>Open source app walkthrough evidence.</p>')
      expect(html).not.include('<li>Seal 已获得 1</li>')
      expect(html).not.include('<aside class="captions">')
      expect(styles).to.contain('page-break-after: always')
      expect(styles).not.include('@keyframes show-scene')
      expect(styles).not.include('position: absolute')
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

  it('rejects scenes without matching narration instead of using storyboard or evidence text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-hyperframes-no-narration-'))

    try {
      let error: unknown

      try {
        await writeHyperframesProject({
          narration: {
            language: 'zh-CN',
            segments: [],
            version: 1,
          },
          outputDir: root,
          storyboard: {
            language: 'zh-CN',
            scenes: [{
              duration: 1,
              evidence: [{
                ref: 'chunks/000/transcript.json',
                text: 'This evidence must not become rendered narration.',
                type: 'asr',
              }],
              id: 'scene-1',
              narration: 'This storyboard narration must not become rendered narration.',
              start: 0,
              visualStyle: 'slide_explainer',
            }],
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
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('missing a matching LLM-authored narration segment')
      expect(String(error)).to.include('no scene-index narration fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects narration timing gaps instead of using storyboard scene timing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-hyperframes-no-narration-timing-'))

    try {
      let error: unknown

      try {
        await writeHyperframesProject({
          narration: {
            language: 'zh-CN',
            segments: [{
              id: 'narration-1',
              sceneId: 'scene-1',
              text: '必须显式提供字幕时间。',
            }],
            version: 1,
          },
          outputDir: root,
          storyboard: {
            language: 'zh-CN',
            scenes: [{
              duration: 1,
              evidence: [],
              id: 'scene-1',
              narration: 'Storyboard timing must not fill narration timing.',
              start: 0,
              visualStyle: 'slide_explainer',
            }],
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
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('is missing start')
      expect(String(error)).to.include('no scene timing fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('reports render-plan narration mismatches as template errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-hyperframes-plan-narration-'))
    const narration = {
      language: 'zh-CN',
      segments: [{
        duration: 1,
        id: 'narration-1',
        sceneId: 'scene-1',
        start: 0,
        text: '显式 narration 必须进入 render plan。',
      }],
      version: 1 as const,
    }
    const storyboard = {
      language: 'zh-CN',
      scenes: [{
        duration: 1,
        evidence: [],
        id: 'scene-1',
        narration: 'Storyboard narration is not a render-plan substitute.',
        start: 0,
        visualStyle: 'slide_explainer',
      }],
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
      const plan = JSON.parse(await readText(result.planPath)) as Record<string, unknown>

      delete plan.narration
      await writeText(result.planPath, `${JSON.stringify(plan, null, 2)}\n`)

      const quality = await checkHyperframesTemplateProject({
        entryHtml: result.entryHtml,
        narration,
        planPath: result.planPath,
        storyboard,
        stylesPath: result.stylesPath,
        timeline,
      })

      expect(quality.ok).to.equal(false)
      expect(quality.issues.map((issue) => issue.code)).to.include('hyperframes.template.plan_narration_count_mismatch')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

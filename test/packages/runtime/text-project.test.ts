import {expect} from '#test/expect'
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createTextExplainerProject} from '../../../packages/runtime/src/text-project.js'
import {exportProject} from '../../../packages/runtime/src/export.js'
import {readProjectQualityDetails} from '../../../packages/runtime/src/project-quality.js'
import {renderProject} from '../../../packages/runtime/src/render-project.js'

describe('text explainer project', () => {
  it('creates a renderable PPT-style HyperFrames project from text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-text-'))
    const inputPath = join(root, 'notes.md')

    try {
      await writeFile(
        inputPath,
        [
          '安卓开源软件推荐。这一页介绍为什么开源工具适合长期使用，重点是免费、透明和可替换。',
          '',
          'Seal 是下载器。它支持复制链接、选择画质、下载字幕和封面，并按平台保存下载记录。',
          '',
          'Music Free 是插件化播放器。用户先安装音乐源插件，再搜索歌曲、专辑和歌单。',
          '',
          'Simple Live 聚合多个直播平台。它适合只想观看直播、不需要互动和送礼物的用户。',
        ].join('\n'),
      )

      const result = await createTextExplainerProject({
        inputPath,
        maxSlideCharacters: 60,
        projectId: 'text-demo',
        slideSeconds: 12,
        title: '安卓开源软件推荐',
        workspaceDir: root,
      })
      const storyboard = JSON.parse(await readFile(result.artifacts.storyboard, 'utf8')) as {scenes: Array<{visualStyle: string}>}
      const narration = JSON.parse(await readFile(result.artifacts.narration, 'utf8')) as {segments: Array<{text: string}>}
      const quality = await readProjectQualityDetails('text-demo', root)

      expect(result.slides).to.be.greaterThan(1)
      expect(storyboard.scenes.every((scene) => scene.visualStyle === 'slide_explainer')).to.equal(true)
      expect(narration.segments.every((segment) => segment.text.startsWith('第 '))).to.equal(true)
      expect(quality.ok).to.equal(true)
      expect(quality.content).to.deep.equal({errors: 0, issues: 0, warnings: 0})

      const render = await renderProject('text-demo', {workspaceDir: root})

      expect(render.renderer).to.equal('hyperframes')

      if (render.renderer === 'hyperframes') {
        const html = await readFile(render.entryHtml, 'utf8')

        expect(html).to.contain('Slide 1')
        expect(html).to.contain('scene__bullets')
        expect(html).to.contain('安卓开源软件推荐')
      }

      const exported = await exportProject({
        outputPath: join(root, 'out'),
        projectId: 'text-demo',
        workspaceDir: root,
      })

      expect(exported.format).to.equal('hyperframes')
      expect((await stat(join(exported.outputPath, 'index.html'))).isFile()).to.equal(true)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

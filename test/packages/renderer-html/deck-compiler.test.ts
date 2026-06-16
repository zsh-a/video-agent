import {expect} from '#test/expect'
import {readText} from '#test/fs'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeDeckHtmlProject} from '../../../packages/renderer-html/src/deck-compiler.js'

describe('html deck compiler', () => {
  it('writes an HTML slide project directly from DeckIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-'))

    try {
      const result = await writeDeckHtmlProject({
        outputDir: root,
        timedDeck: {
          audioRef: 'audio/deck_voiceover.wav',
          deck: {
            format: 'portrait_1080x1920',
            inputMode: 'script-generated',
            language: 'zh-CN',
            slides: [
              {
                blockIds: ['block-001'],
                bullets: ['Core 独立', 'Renderer 可替换'],
                evidence: [{ref: 'block-001', text: 'DeckIR evidence', type: 'research'}],
                slideId: 'slide-001',
                speakerNote: '这一页说明核心架构。',
                title: '视频 Agent 的正确架构',
                type: 'title',
                visual: {assetRefs: [], kind: 'title-card'},
              },
              {
                blockIds: ['block-002'],
                bullets: ['Film 是 media-first', 'Deck 是 content-first'],
                evidence: [],
                slideId: 'slide-002',
                title: '两条业务 Pipeline',
                type: 'bullet',
                visual: {assetRefs: [], kind: 'text'},
              },
            ],
            theme: 'tech',
            title: '视频 Agent 的正确架构',
            version: 1,
          },
          timings: [
            {end: 6, slideId: 'slide-001', start: 0},
            {end: 18, slideId: 'slide-002', start: 6},
          ],
          version: 1,
        },
      })

      expect(await fileSize(result.entryHtml)).to.be.greaterThan(0)
      expect(await fileSize(result.planPath)).to.be.greaterThan(0)
      expect(await fileSize(result.runtimePath)).to.be.greaterThan(0)
      expect(await fileSize(result.stylesPath)).to.be.greaterThan(0)

      const html = await readText(result.entryHtml)
      const styles = await readText(result.stylesPath)
      const runtime = await readText(result.runtimePath)
      const plan = JSON.parse(await readText(result.planPath)) as {audioRef?: string; deck: {title: string}; duration: number; timings: Array<{slideId: string}>}

      expect(html).to.contain('id="deck-render-plan"')
      expect(html).to.contain('data-format="portrait_1080x1920"')
      expect(html).to.contain('data-slide="slide-001"')
      expect(html).to.contain('data-start="6"')
      expect(html).to.contain('视频 Agent 的正确架构')
      expect(html).to.contain('Film 是 media-first')
      expect(html).to.contain('DeckIR evidence')
      expect(styles).to.contain('aspect-ratio: 9 / 16')
      expect(styles).to.contain('@media (max-width: 700px)')
      expect(runtime).to.contain('window.videoAgentDeck')
      expect(plan.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(plan.deck.title).to.equal('视频 Agent 的正确架构')
      expect(plan.duration).to.equal(18)
      expect(plan.timings.map((timing) => timing.slideId)).to.deep.equal(['slide-001', 'slide-002'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

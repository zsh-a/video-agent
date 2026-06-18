import {expect} from '#test/expect'
import {readText} from '#test/fs'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {buildChromiumScreenshotArgs, deckFramePreviewTime} from '../../../packages/renderer-html/src/chromium.js'
import {writeDeckHtmlProject} from '../../../packages/renderer-html/src/deck/compiler.js'
import {deckTemplateManifestForLLM, validateSlideAgainstTemplateManifest} from '../../../packages/renderer-html/src/deck/template-manifest.js'

describe('html deck compiler', () => {
  it('exposes a template manifest for LLM slide-type selection', () => {
    const threePoints = deckTemplateManifestForLLM.templates.find((template) => template.type === 'three-points')
    const process = deckTemplateManifestForLLM.templates.find((template) => template.type === 'process')

    expect(deckTemplateManifestForLLM.templates.map((template) => template.type)).to.include.members(['hero', 'three-points', 'comparison', 'process', 'summary'])
    expect(threePoints?.fields).to.deep.equal(['title', 'points'])
    expect(threePoints?.limits.points).to.equal(3)
    expect(threePoints?.quality_rules.requiredVisibleElements).to.include('.point')
    expect(process?.limits.steps).to.equal(5)
  })

  it('validates DeckIR slides against template manifest limits', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'progressive-reveal',
      points: ['A', 'B', 'C', 'D'],
      slideId: 'slide-001',
      title: '核心原则',
      type: 'three-points',
    })

    expect(issues.some((issue) => issue.includes('point limit 3'))).to.equal(true)
  })

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
                evidence: [{ref: 'block-001', text: 'DeckIR evidence', type: 'research'}],
                motion: 'cinematic-rise',
                points: ['Core 独立', 'Renderer 可替换'],
                slideId: 'slide-001',
                speakerNote: '这一页说明核心架构。',
                title: '视频 Agent 的正确架构',
                type: 'hero',
                visual: {assetRefs: [], kind: 'title-card'},
              },
              {
                blockIds: ['block-002'],
                evidence: [],
                motion: 'progressive-reveal',
                points: ['Film 是 media-first', 'Deck 是 content-first'],
                slideId: 'slide-002',
                title: '两条业务 Pipeline',
                type: 'three-points',
                visual: {assetRefs: [], kind: 'text'},
              },
            ],
            theme: 'elegant-dark',
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
      expect(await fileSize(join(root, 'fonts', 'noto-sans-sc-chinese-simplified-400-normal.woff2'))).to.be.greaterThan(0)
      expect(await fileSize(join(root, 'fonts', 'noto-sans-sc-chinese-simplified-700-normal.woff2'))).to.be.greaterThan(0)

      const html = await readText(result.entryHtml)
      const styles = await readText(result.stylesPath)
      const runtime = await readText(result.runtimePath)
      const plan = JSON.parse(await readText(result.planPath)) as {
        audioRef?: string
        canvas: {height: number; width: number}
        deck: {title: string}
        duration: number
        motion: {steps: Array<{preset: string; selector: string}>}
        timings: Array<{slideId: string}>
        version: number
      }
      const embeddedPlanText = html.match(/<script type="application\/json" id="deck-render-plan">(?<json>[\s\S]*?)<\/script>/)?.groups?.json
      const embeddedPlan = JSON.parse(embeddedPlanText ?? '{}') as {audioRef?: string; deck?: {title: string}}

      expect(html).to.contain('id="deck-render-plan"')
      expect(html).not.include('&quot;audioRef&quot;')
      expect(html).to.contain('data-format="portrait_1080x1920"')
      expect(html).to.contain('data-slide="slide-001"')
      expect(html).to.contain('data-start="6"')
      expect(html).to.contain('class="stage"')
      expect(html).to.contain('视频 Agent 的正确架构')
      expect(html).to.contain('Film 是 media-first')
      expect(html).not.include('class="slide__evidence"')
      expect(styles).to.contain('--canvas-w: 1080px')
      expect(styles).to.contain('--safe-bottom: 132px')
      expect(styles).to.contain('@font-face')
      expect(styles).to.contain('Noto Sans SC')
      expect(styles).to.contain('body[data-capture="slide"]')
      expect(styles).not.include('@keyframes')
      expect(runtime).to.contain('window.vagent')
      expect(runtime).to.contain('function seek(timeSeconds)')
      expect(runtime).to.contain('requestedTimeParam')
      expect(runtime).to.contain('firstSlidePreviewTime()')
      expect(runtime).to.contain('latestMotionEndForSlide')
      expect(plan.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(embeddedPlan.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(embeddedPlan.deck?.title).to.equal('视频 Agent 的正确架构')
      expect(plan.canvas).to.deep.equal({height: 1920, width: 1080})
      expect(plan.deck.title).to.equal('视频 Agent 的正确架构')
      expect(plan.duration).to.equal(18)
      expect(plan.version).to.equal(2)
      expect(plan.motion.steps.some((step) => step.preset === 'cinematic-rise')).to.equal(true)
      expect(plan.motion.steps.some((step) => step.selector.includes('.point'))).to.equal(true)
      expect(plan.timings.map((timing) => timing.slideId)).to.deep.equal(['slide-001', 'slide-002'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('builds Chromium screenshot commands for a single slide capture', () => {
    const args = buildChromiumScreenshotArgs({
      command: ['chromium'],
      entryHtml: '/tmp/deck/index.html',
      outputPath: '/tmp/deck/slide-001.png',
      slideId: 'slide-001',
      time: 1.25,
      viewport: {height: 1920, width: 1080},
    })
    const url = args.at(-1)

    expect(args).to.include('--headless=new')
    expect(args).to.include('--window-size=1080,1920')
    expect(args).to.include('--screenshot=/tmp/deck/slide-001.png')
    expect(url).to.contain('index.html')
    expect(url).to.contain('capture=slide')
    expect(url).to.contain('slide=slide-001')
    expect(url).to.contain('time=1.25')
  })

  it('renders incomplete comparison slides without placeholder option labels', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-fallback-'))

    try {
      const result = await writeDeckHtmlProject({
        outputDir: root,
        timedDeck: {
          deck: {
            format: 'landscape_1920x1080',
            inputMode: 'script-generated',
            language: 'zh-CN',
            slides: [
              {
                blockIds: [],
                evidence: [],
                motion: 'card-stack',
                points: [],
                slideId: 'slide-001',
                speakerNote: '市场误分类需要比较旧认知和新事实。',
                subtitle: '市场以为它是什么 vs 它正在变成什么',
                title: '测试市场误分类',
                type: 'comparison',
                visual: {assetRefs: [], kind: 'text'},
              },
              {
                blockIds: [],
                evidence: [],
                motion: 'number-count',
                points: ['需求确定性', '传导清晰度', '业务纯度'],
                slideId: 'slide-002',
                stat: {
                  caption: '七个维度共同决定候选标的优先级',
                  label: '评分维度',
                  value: '7',
                },
                title: 'Alpha 评分',
                type: 'stat',
                visual: {assetRefs: [], kind: 'chart'},
              },
            ],
            theme: 'finance-terminal',
            title: 'Serenity Alpha',
            version: 1,
          },
          timings: [
            {end: 8, slideId: 'slide-001', start: 0},
            {end: 16, slideId: 'slide-002', start: 8},
          ],
          version: 1,
        },
      })
      const html = await readText(result.entryHtml)
      const styles = await readText(result.stylesPath)

      expect(html).not.include('Option A')
      expect(html).not.include('Option B')
      expect(html).to.contain('市场误分类需要比较旧认知和新事实')
      expect(html).to.contain('class="stat-layout"')
      expect(html).to.contain('需求确定性')
      expect(styles).to.contain('.process-list--dense')
      expect(styles).to.contain('.stat-layout')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('chooses completed slide states for static frame capture', () => {
    expect(deckFramePreviewTime(26.88, 9.76)).to.equal(34.883)
    expect(deckFramePreviewTime(50.72, 12.32)).to.equal(60.822)
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

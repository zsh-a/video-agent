import {expect} from '#test/expect'
import {readText} from '#test/fs'
import {mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {buildChromiumScreenshotArgs, captureDeckHtmlFrameSequence, captureDeckHtmlKeyframes, createDeckHtmlFrameSequence, createDeckHtmlKeyframes, deckFramePreviewTime} from '../../../packages/renderer-html/src/chromium.js'
import {writeDeckHtmlProject} from '../../../packages/renderer-deck/src/deck/compiler/index.js'
import {deckTemplateManifestForLLM, validateSlideAgainstTemplateManifest} from '../../../packages/renderer-deck/src/deck/templates/manifest.js'

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
                transitionOut: {duration: 0.55, type: 'crossfade'},
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
        motion: {
          timeline: {
            fps: number
            scenes: Array<{id: string; sourceId?: string}>
            tracks: Array<{property: string; target: {kind: string; value: string}}>
            version: number
          }
        }
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
      expect(runtime).to.contain('function applyMotionTimeline(time)')
      expect(runtime).to.contain('function requireRenderPlan(planElement)')
      expect(runtime).to.contain('function requireMotionPlan(plan)')
      expect(runtime).to.contain('no DOM timing fallback is allowed')
      expect(runtime.includes('function applyPreset')).to.equal(false)
      expect(runtime.includes('plan?.motion?.steps')).to.equal(false)
      expect(runtime.includes('plan?.motion')).to.equal(false)
      expect(runtime.includes('plan?.duration')).to.equal(false)
      expect(runtime.includes('readSlideState')).to.equal(false)
      expect(runtime.includes('timeline?.tracks || []')).to.equal(false)
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
      expect('steps' in plan.motion).to.equal(false)
      expect(plan.motion.timeline.version).to.equal(1)
      expect(plan.motion.timeline.fps).to.equal(30)
      expect(plan.motion.timeline.scenes.map((scene) => scene.id)).to.deep.equal(['slide-001', 'slide-002'])
      expect(plan.motion.timeline.tracks.some((track) => track.property === 'scale' && track.target.value.includes('.slide__title'))).to.equal(true)
      expect(plan.motion.timeline.tracks.some((track) => track.property === 'translateY' && track.target.kind === 'css-selector')).to.equal(true)
      expect(plan.motion.timeline.tracks.some((track) => track.property === 'opacity' && track.target.value.includes('.point'))).to.equal(true)
      expect(plan.timings.map((timing) => timing.slideId)).to.deep.equal(['slide-001', 'slide-002'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('renders code slides with Shiki highlighting while preserving code formatting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-code-'))

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
                code: {
                  language: 'ts',
                  text: 'const answer = 42\nif (answer > 0) {\n  console.log(answer)\n}',
                },
                evidence: [],
                motion: 'progressive-reveal',
                points: [],
                slideId: 'slide-code',
                title: '代码样例',
                type: 'code',
                visual: {assetRefs: [], kind: 'text'},
              },
            ],
            theme: 'elegant-dark',
            title: 'Code Deck',
            version: 1,
          },
          timings: [
            {end: 8, slideId: 'slide-code', start: 0},
          ],
          version: 1,
        },
      })

      const html = await readText(result.entryHtml)
      const styles = await readText(result.stylesPath)

      expect(html).to.contain('class="code-block__highlight"')
      expect(html).to.contain('class="shiki github-dark-default"')
      expect(html).to.contain('  console.')
      expect(html.includes('whitespace-normal')).to.equal(false)
      expect(html.includes('font-sans')).to.equal(false)
      expect(styles).to.contain('counter-reset: code-line')
      expect(styles).to.contain('.code-block__highlight .shiki .line::before')
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

  it('rejects frame planning without slide timings instead of defaulting to the first slide', () => {
    expect(() => createDeckHtmlFrameSequence({
      fps: 30,
      outputDir: '/tmp/deck-frames',
      timedDeck: {
        deck: {
          format: 'portrait_1080x1920',
          inputMode: 'script-generated',
          language: 'zh-CN',
          slides: [{
            blockIds: [],
            evidence: [],
            motion: 'fade-in',
            points: ['A'],
            slideId: 'slide-001',
            title: 'Missing timing',
            type: 'three-points',
          }],
          theme: 'clean-white',
          title: 'Missing timing',
          version: 1,
        },
        timings: [],
        version: 1,
      },
    })).to.throw('could not resolve a slide timing')
  })

  it('rejects incomplete comparison slides instead of rendering placeholder or empty comparison content', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-fallback-'))

    try {
      let error: unknown

      try {
        await writeDeckHtmlProject({
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
                  transitionOut: {duration: 0.55, type: 'crossfade'},
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
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.contain('missing complete comparison content')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('chooses completed slide states for static frame capture', () => {
    expect(deckFramePreviewTime(26.88, 9.76)).to.equal(34.883)
    expect(deckFramePreviewTime(50.72, 12.32)).to.equal(60.822)
  })

  it('plans timestamped frame sequences for animated video capture', () => {
    const frames = createDeckHtmlFrameSequence({
      fps: 10,
      outputDir: '/tmp/deck-frames',
      timedDeck: {
        deck: {
          slides: [
            {
              slideId: 'slide-001',
              title: 'One',
              type: 'hero',
            },
            {
              slideId: 'slide-002',
              title: 'Two',
              type: 'summary',
            },
          ],
          title: 'Deck',
          version: 1,
        },
        timings: [
          {end: 0.2, slideId: 'slide-001', start: 0},
          {end: 0.5, slideId: 'slide-002', start: 0.2},
        ],
        version: 1,
      },
    })

    expect(frames).to.have.length(5)
    expect(frames.map((frame) => frame.frame)).to.deep.equal([1, 2, 3, 4, 5])
    expect(frames.map((frame) => frame.time)).to.deep.equal([0, 0.1, 0.2, 0.3, 0.4])
    expect(frames.map((frame) => frame.slideId)).to.deep.equal(['slide-001', 'slide-001', 'slide-002', 'slide-002', 'slide-002'])
    expect(frames[0]?.path).to.equal('/tmp/deck-frames/frame-000001.png')
  })

  it('plans browser keyframes for independent visual quality capture', () => {
    const keyframes = createDeckHtmlKeyframes({
      fps: 10,
      outputDir: '/tmp/deck-keyframes',
      timedDeck: {
        deck: {
          slides: [
            {
              slideId: 'slide-001',
              title: 'One',
              type: 'hero',
            },
            {
              slideId: 'slide-002',
              title: 'Two',
              type: 'summary',
            },
          ],
          title: 'Deck',
          version: 1,
        },
        timings: [
          {end: 0.2, slideId: 'slide-001', start: 0},
          {end: 0.5, slideId: 'slide-002', start: 0.2},
        ],
        version: 1,
      },
    })

    expect(keyframes.length).to.be.greaterThan(2)
    expect(keyframes[0]).to.deep.include({frame: 1, label: 'start', path: '/tmp/deck-keyframes/keyframe-000001.png', slideId: 'slide-001', time: 0})
    expect(keyframes.some((frame) => frame.label === 'middle')).to.equal(true)
    expect(keyframes.some((frame) => frame.label === 'end')).to.equal(true)
  })

  it('captures animated frame sequences with bounded concurrency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-concurrent-'))
    const logPath = join(root, 'capture.log')
    const chromiumPath = join(root, 'fake-chromium.ts')
    const timedDeck = {
      deck: {
        format: 'portrait_1080x1920' as const,
        inputMode: 'script-generated' as const,
        language: 'zh-CN',
        slides: [
          {
            blockIds: [],
            evidence: [],
            motion: 'fade-in' as const,
            points: [],
            slideId: 'slide-001',
            speakerNote: 'One',
            title: 'One',
            type: 'hero' as const,
            visual: {assetRefs: [], kind: 'title-card' as const},
          },
        ],
        theme: 'elegant-dark' as const,
        title: 'Deck',
        version: 1 as const,
      },
      timings: [
        {end: 0.4, slideId: 'slide-001', start: 0},
      ],
      version: 1 as const,
    }

    try {
      await writeFile(
        chromiumPath,
        [
          "import {appendFile} from 'node:fs/promises'",
          'const screenshotArg = Bun.argv.find((arg) => arg.startsWith("--screenshot="))',
          'if (screenshotArg === undefined) process.exit(2)',
          'const outputPath = screenshotArg.slice("--screenshot=".length)',
          `const logPath = ${JSON.stringify(logPath)}`,
          'await appendFile(logPath, `start:${outputPath}\\n`)',
          'await Bun.sleep(150)',
          "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8//8/AwMDCwMYAAAkFAMDuxa40wAAAABJRU5ErkJggg==', 'base64')",
          'await Bun.write(outputPath, png)',
          'await appendFile(logPath, `end:${outputPath}\\n`)',
          '',
        ].join('\n'),
      )
      const htmlProject = await writeDeckHtmlProject({
        outputDir: join(root, 'html'),
        timedDeck,
      })
      const result = await captureDeckHtmlFrameSequence({
        backend: 'chromium',
        chromiumCommand: ['bun', chromiumPath],
        concurrency: 2,
        frameEnd: 4,
        frameStart: 2,
        fps: 10,
        outputDir: join(root, 'frames'),
        projectDir: htmlProject.outputDir,
        timedDeck,
      })
      const lines = (await readText(logPath)).trim().split('\n')
      const firstEndIndex = lines.findIndex((line) => line.startsWith('end:'))
      const secondStartIndex = lines.findIndex((line, index) => index > 0 && line.startsWith('start:'))

      expect(result.concurrency).to.equal(2)
      expect(result.frameStart).to.equal(2)
      expect(result.frameEnd).to.equal(4)
      expect(result.frames).to.have.length(4)
      expect(result.capturedFrames).to.equal(3)
      expect(result.skippedFrames).to.equal(0)
      expect(secondStartIndex).to.be.greaterThan(-1)
      expect(firstEndIndex).to.be.greaterThan(-1)
      expect(secondStartIndex).to.be.lessThan(firstEndIndex)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('captures browser keyframes before full frame sequence rendering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-keyframes-'))
    const chromiumPath = join(root, 'fake-chromium.ts')
    const timedDeck = {
      deck: {
        format: 'portrait_1080x1920' as const,
        inputMode: 'script-generated' as const,
        language: 'zh-CN',
        slides: [
          {
            blockIds: [],
            evidence: [],
            motion: 'fade-in' as const,
            points: [],
            slideId: 'slide-001',
            speakerNote: 'One',
            title: 'One',
            type: 'hero' as const,
            visual: {assetRefs: [], kind: 'title-card' as const},
          },
        ],
        theme: 'elegant-dark' as const,
        title: 'Deck',
        version: 1 as const,
      },
      timings: [
        {end: 0.4, slideId: 'slide-001', start: 0},
      ],
      version: 1 as const,
    }

    try {
      await writeFile(
        chromiumPath,
        [
          'const screenshotArg = Bun.argv.find((arg) => arg.startsWith("--screenshot="))',
          'if (screenshotArg === undefined) process.exit(2)',
          'const outputPath = screenshotArg.slice("--screenshot=".length)',
          "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8//8/AwMDCwMYAAAkFAMDuxa40wAAAABJRU5ErkJggg==', 'base64')",
          'await Bun.write(outputPath, png)',
          '',
        ].join('\n'),
      )
      const htmlProject = await writeDeckHtmlProject({
        outputDir: join(root, 'html'),
        timedDeck,
      })
      const result = await captureDeckHtmlKeyframes({
        backend: 'chromium',
        chromiumCommand: ['bun', chromiumPath],
        concurrency: 2,
        fps: 10,
        outputDir: join(root, 'keyframes'),
        projectDir: htmlProject.outputDir,
        timedDeck,
      })

      expect(result.concurrency).to.equal(2)
      expect(result.capturedFrames).to.equal(result.frames.length)
      expect(result.frames[0]?.path.endsWith('keyframe-000001.png')).to.equal(true)
      expect(await fileSize(result.frames[0]?.path ?? '')).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('captures animated frame sequences through a Playwright command protocol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-frame-playwright-'))
    const playwrightPath = join(root, 'fake-playwright-frames.ts')
    const timedDeck = {
      deck: {
        format: 'portrait_1080x1920' as const,
        inputMode: 'script-generated' as const,
        language: 'zh-CN',
        slides: [
          {
            blockIds: [],
            evidence: [],
            motion: 'fade-in' as const,
            points: [],
            slideId: 'slide-001',
            speakerNote: 'One',
            title: 'One',
            type: 'hero' as const,
            visual: {assetRefs: [], kind: 'title-card' as const},
          },
        ],
        theme: 'elegant-dark' as const,
        title: 'Deck',
        version: 1 as const,
      },
      timings: [
        {end: 0.4, slideId: 'slide-001', start: 0},
      ],
      version: 1 as const,
    }

    try {
      await writeFile(
        playwrightPath,
        [
          'const manifestPath = Bun.argv.at(-1)',
          'if (manifestPath === undefined) process.exit(2)',
          'const manifest = await Bun.file(manifestPath).json()',
          "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8//8/AwMDCwMYAAAkFAMDuxa40wAAAABJRU5ErkJggg==', 'base64')",
          'for (const frame of manifest.frames) {',
          '  if (typeof frame.url !== "string" || !frame.url.includes("capture=slide")) process.exit(3)',
          '  await Bun.write(frame.path, png)',
          '}',
          '',
        ].join('\n'),
      )
      const htmlProject = await writeDeckHtmlProject({
        outputDir: join(root, 'html'),
        timedDeck,
      })
      const result = await captureDeckHtmlFrameSequence({
        backend: 'playwright',
        concurrency: 2,
        frameEnd: 3,
        frameStart: 2,
        fps: 10,
        outputDir: join(root, 'frames'),
        playwrightCommand: ['bun', playwrightPath],
        projectDir: htmlProject.outputDir,
        timedDeck,
      })

      expect(result.backend).to.equal('playwright')
      expect(result.command.slice(0, 2)).to.deep.equal(['bun', playwrightPath])
      expect(result.frameStart).to.equal(2)
      expect(result.frameEnd).to.equal(3)
      expect(result.frames).to.have.length(4)
      expect(result.capturedFrames).to.equal(2)
      expect(await fileSize(result.frames[1]?.path ?? '')).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('captures browser keyframes through a Playwright command protocol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-renderer-html-playwright-'))
    const playwrightPath = join(root, 'fake-playwright.ts')
    const timedDeck = {
      deck: {
        format: 'portrait_1080x1920' as const,
        inputMode: 'script-generated' as const,
        language: 'zh-CN',
        slides: [
          {
            blockIds: [],
            evidence: [],
            motion: 'fade-in' as const,
            points: [],
            slideId: 'slide-001',
            speakerNote: 'One',
            title: 'One',
            type: 'hero' as const,
            visual: {assetRefs: [], kind: 'title-card' as const},
          },
        ],
        theme: 'elegant-dark' as const,
        title: 'Deck',
        version: 1 as const,
      },
      timings: [
        {end: 0.4, slideId: 'slide-001', start: 0},
      ],
      version: 1 as const,
    }

    try {
      await writeFile(
        playwrightPath,
        [
          'const manifestPath = Bun.argv.at(-1)',
          'if (manifestPath === undefined) process.exit(2)',
          'const manifest = await Bun.file(manifestPath).json()',
          "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8//8/AwMDCwMYAAAkFAMDuxa40wAAAABJRU5ErkJggg==', 'base64')",
          'for (const frame of manifest.frames) {',
          '  if (typeof frame.url !== "string" || !frame.url.includes("capture=slide")) process.exit(3)',
          '  await Bun.write(frame.path, png)',
          '}',
          '',
        ].join('\n'),
      )
      const htmlProject = await writeDeckHtmlProject({
        outputDir: join(root, 'html'),
        timedDeck,
      })
      const result = await captureDeckHtmlKeyframes({
        backend: 'playwright',
        concurrency: 2,
        fps: 10,
        outputDir: join(root, 'keyframes'),
        playwrightCommand: ['bun', playwrightPath],
        projectDir: htmlProject.outputDir,
        timedDeck,
      })

      expect(result.backend).to.equal('playwright')
      expect(result.command.slice(0, 2)).to.deep.equal(['bun', playwrightPath])
      expect(result.capturedFrames).to.equal(result.frames.length)
      expect(await fileSize(result.frames[0]?.path ?? '')).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

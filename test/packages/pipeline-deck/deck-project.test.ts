import {expect} from '#test/expect'
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GenerateObjectRequest, LLMClient} from '../../../packages/llm/src/index.js'

import {runProcess} from '../../../packages/media/src/process.js'
import {exportProject} from '../../../packages/runtime/src/render/export.js'
import {verifyProjectArtifacts} from '../../../packages/runtime/src/artifacts/index.js'
import {writeConfig} from '../../../packages/runtime/src/shared/config.js'
import {readProjectQualityDetails} from '../../../packages/runtime/src/project/quality.js'
import {readProjectVisualSamples} from '../../../packages/runtime/src/project/visual-samples.js'
import {createDeckAudioAnchoredProject, createDeckExplainerProject, createDeckFinalRenderProject, createDeckFrameShardBatchProject, createDeckFrameShardPlanProject, createDeckRemotionRenderProject, createDeckRendererBackendProject, createDeckSummarizeProject, createDeckVoiceoverProject} from '../../../packages/pipeline-deck/src/index.js'

function createDeckPlanningLLMClient(onRequest?: (input: GenerateObjectRequest<unknown>) => void): LLMClient {
  return {
    async generateObject(input) {
      onRequest?.(input as GenerateObjectRequest<unknown>)

      return {
        object: {
          summary: 'Serenity Alpha turns market news into testable financial hypotheses.',
          title: 'Serenity Alpha',
          slides: [
            {
              motion: 'cinematic-rise',
              points: ['从新闻开始', '落到财务报表'],
              speakerNote: 'Serenity Alpha 的核心，是把市场新闻翻译成可验证的财务假设。',
              title: 'Serenity Alpha 方法',
              type: 'hero',
            },
            {
              points: ['观察需求是否已经发生', '区分故事和真实订单'],
              speakerNote: '第一步不是判断新闻是否热闹，而是确认需求变化是否已经出现。',
              title: '先验证需求',
              type: 'three-points',
            },
            {
              points: ['收入', '毛利率', '经营杠杆'],
              speakerNote: '第二步把需求变化映射到收入、毛利率和经营杠杆这些具体财务行项目。',
              title: '翻译成财务语言',
              type: 'three-points',
            },
            {
              points: ['确认指标', '证伪条件'],
              speakerNote: '最后用未来几个季度的财报和电话会指标，确认或者否定这条假设。',
              title: '建立验证链',
              type: 'summary',
            },
          ],
        },
      }
    },
    async generateText() {
      throw new Error('Not used by this test.')
    },
    streamText() {
      throw new Error('Not used by this test.')
    },
  } satisfies LLMClient
}

describe('deck explainer project', () => {
  it('creates a PPT-style deck project from text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-'))
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

      const result = await createDeckExplainerProject({
        inputPath,
        llmClient: createDeckPlanningLLMClient(),
        maxSlideCharacters: 60,
        projectId: 'deck-demo',
        slideSeconds: 12,
        title: '安卓开源软件推荐',
        workspaceDir: root,
      })
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {format: string; slides: Array<{motion: string; points: string[]; slideId: string; type: string}>; theme: string}
      const document = JSON.parse(await readFile(result.artifacts.document, 'utf8')) as {blocks: Array<{id: string}>; source: {sourceType: string}}
      const claims = JSON.parse(await readFile(result.artifacts.claims, 'utf8')) as {claims: Array<{blockId: string; confidence: number; id: string; type: string}>}
      const sourceQuotes = JSON.parse(await readFile(result.artifacts.sourceQuotes, 'utf8')) as {quotes: Array<{blockId: string; text: string}>}
      const narration = JSON.parse(await readFile(result.artifacts.narration, 'utf8')) as {segments: Array<{text: string}>}
      const storyboard = JSON.parse(await readFile(result.artifacts.storyboard, 'utf8')) as {scenes: Array<{visualStyle: string}>}
      const timedDeck = JSON.parse(await readFile(result.artifacts.timedDeck, 'utf8')) as {timings: Array<{slideId: string}>}
      const quality = await readProjectQualityDetails('deck-demo', root)

      expect(result.slides).to.be.greaterThan(1)
      expect(deck.format).to.equal('portrait_1080x1920')
      expect(deck.theme).to.equal('elegant-dark')
      expect(deck.slides.length).to.equal(result.slides)
      expect(deck.slides[0]?.type).to.equal('hero')
      expect(deck.slides.every((slide) => slide.motion.length > 0)).to.equal(true)
      expect(deck.slides.every((slide) => Array.isArray(slide.points))).to.equal(true)
      expect(document.source.sourceType).to.equal('markdown')
      expect(document.blocks.length).to.equal(result.slides)
      expect(claims.claims.length).to.be.greaterThan(0)
      expect(claims.claims.every((claim) => document.blocks.some((block) => block.id === claim.blockId))).to.equal(true)
      expect(claims.claims.every((claim) => claim.confidence >= 0.7)).to.equal(true)
      expect(sourceQuotes.quotes.length).to.equal(document.blocks.length)
      expect(sourceQuotes.quotes.every((quote) => quote.text.length > 0)).to.equal(true)
      expect(storyboard.scenes.every((scene) => scene.visualStyle === 'slide_explainer')).to.equal(true)
      expect(timedDeck.timings.map((timing) => timing.slideId)).to.deep.equal(deck.slides.map((slide) => slide.slideId))
      expect(narration.segments.every((segment) => segment.text.length > 0)).to.equal(true)
      expect(quality.ok).to.equal(true)
      expect(quality.content).to.deep.equal({errors: 0, issues: 0, warnings: 0})
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('plans Markdown Deck content through an injected LLM instead of raw text chunking', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-llm-'))
    const inputPath = join(root, 'skill.md')
    let request: GenerateObjectRequest<unknown> | undefined

    try {
      await writeFile(
        inputPath,
        [
          '---',
          'name: serenity-alpha',
          'description: Internal skill metadata that should not become a slide.',
          '---',
          '',
          '# Serenity Alpha',
          '',
          '## Core Principle',
          '',
          'Turn news into a testable alpha hypothesis.',
          '',
          '```text',
          'news -> demand -> revenue',
          '```',
          '',
          '## Answer Shape',
          '',
          'Open with the company that best fits the alpha hypothesis.',
          '',
          '## Output Template',
          '',
          'Use sections A through I, including validation metrics, downside risk, and position posture.',
          '',
          '## Quality Bar',
          '',
          'Anchor the analysis in observable demand and clear falsification conditions.',
        ].join('\n'),
      )

      const result = await createDeckExplainerProject({
        durationTargetSeconds: 180,
        inputPath,
        llmClient: createDeckPlanningLLMClient((input) => {
          request = input
        }),
        projectId: 'deck-llm-demo',
        workspaceDir: root,
      })
      const prompt = JSON.parse(String(request?.messages?.[0]?.content)) as {
        instructions: string[]
        source: {
          structure: {
            majorHeadings: string[]
            sections: Array<{level: number; preview: string; title: string}>
          }
        }
        target: {
          slideCount: number
          templateManifest: {
            templates: Array<{
              fields: string[]
              limits: Record<string, number>
              type: string
              use_when: string
            }>
          }
        }
      }
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {slides: Array<{motion: string; points: string[]; speakerNote?: string; title: string; type: string}>; title: string}
      const document = JSON.parse(await readFile(result.artifacts.document, 'utf8')) as {text: string}
      const speakerScript = JSON.parse(await readFile(result.artifacts.speakerScript, 'utf8')) as {segments: Array<{text: string}>}

      expect(prompt.instructions.join(' ')).to.contain('Remove YAML frontmatter')
      expect(prompt.instructions.join(' ')).to.contain('target.templateManifest')
      expect(prompt.instructions.join(' ')).to.contain('coverage checklist')
      expect(prompt.instructions.join(' ')).to.contain('source-domain meaning')
      expect(prompt.source.structure.majorHeadings).to.deep.equal(['Serenity Alpha', 'Core Principle', 'Answer Shape', 'Output Template', 'Quality Bar'])
      expect(prompt.source.structure.sections.find((section) => section.title === 'Output Template')?.preview).to.contain('validation metrics')
      expect(prompt.target.templateManifest.templates.map((template) => template.type)).to.include.members(['hero', 'three-points', 'comparison', 'process', 'summary'])
      expect(prompt.target.templateManifest.templates.find((template) => template.type === 'three-points')?.limits.points).to.equal(3)
      expect(prompt.target.slideCount).to.equal(8)
      expect(result.slides).to.equal(4)
      expect(deck.title).to.equal('Serenity Alpha')
      expect(deck.slides[0]?.type).to.equal('hero')
      expect(deck.slides.every((slide) => slide.motion.length > 0)).to.equal(true)
      expect(deck.slides.some((slide) => /---|#|```|name:/.test(`${slide.title} ${slide.points.join(' ')}`))).to.equal(false)
      expect(document.text).not.include('name: serenity-alpha')
      expect(speakerScript.segments.some((segment) => /^第\s*\d+\s*页/.test(segment.text))).to.equal(false)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('normalizes loose LLM Deck plans before creating DeckIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-llm-loose-'))
    const inputPath = join(root, 'skill.md')

    try {
      await writeFile(inputPath, '# Loose Deck\n\nExplain the framework clearly.')

      const result = await createDeckExplainerProject({
        inputPath,
        llmClient: {
          async generateObject(input) {
            return {
              object: input.schema.parse({
                summary: 'Loose plans should be accepted and normalized.',
                theme: 'unknown-theme',
                title: 'Loose Deck',
                slides: [
                  {
                    motion: 'invalid-motion',
                    points: ['A', 'B', 'C', 'D', 'E'],
                    speakerNote: 'Intro note.',
                    title: 'Loose intro',
                    type: 'cover',
                  },
                  {
                    comparison: {
                      left: {
                        label: 'Left',
                        points: ['L1', 'L2', 'L3', 'L4'],
                      },
                      right: {
                        label: 'Right',
                        points: ['R1', 'R2', 'R3', 'R4'],
                      },
                    },
                    points: [],
                    speakerNote: 'Comparison note.',
                    title: 'Loose comparison',
                    type: 'comparison',
                  },
                  {
                    points: ['Only one side was generated'],
                    speakerNote: 'This slide should not stay a comparison.',
                    title: 'Incomplete comparison',
                    type: 'comparison',
                  },
                  {
                    points: ['Supporting reason'],
                    speakerNote: 'This slide should not stay a stat without stat data.',
                    title: 'Missing stat',
                    type: 'stat',
                  },
                ],
              }),
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient,
        projectId: 'deck-llm-loose-demo',
        workspaceDir: root,
      })
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {
        slides: Array<{
          comparison?: {
            left: {points: string[]}
            right: {points: string[]}
          }
          motion: string
          points: string[]
          type: string
        }>
        theme: string
      }

      expect(deck.theme).to.equal('elegant-dark')
      expect(deck.slides[0]?.type).to.equal('hero')
      expect(deck.slides[0]?.points).to.deep.equal(['A', 'B'])
      expect(deck.slides[0]?.motion).to.equal('cinematic-rise')
      expect(deck.slides[1]?.type).to.equal('three-points')
      expect(deck.slides[1]?.points).to.deep.equal(['C', 'D'])
      expect(deck.slides[2]?.type).to.equal('three-points')
      expect(deck.slides[2]?.points).to.deep.equal(['E'])
      expect(deck.slides[3]?.type).to.equal('comparison')
      expect(deck.slides[3]?.comparison?.left.points).to.deep.equal(['L1', 'L2', 'L3'])
      expect(deck.slides[3]?.comparison?.right.points).to.deep.equal(['R1', 'R2', 'R3'])
      expect(deck.slides[4]?.type).to.equal('one-big-idea')
      expect(deck.slides[5]?.type).to.equal('one-big-idea')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('diversifies repeated three-point Deck templates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-template-diversity-'))
    const inputPath = join(root, 'notes.md')

    try {
      await writeFile(inputPath, '# Template Diversity\n\nAvoid repeated template rhythm.')

      const result = await createDeckExplainerProject({
        inputPath,
        llmClient: {
          async generateObject(input) {
            return {
              object: input.schema.parse({
                summary: 'Repeated point slides should not all render with the same template.',
                title: 'Template Diversity',
                slides: [
                  {
                    points: ['A', 'B'],
                    speakerNote: 'Intro note.',
                    title: 'Intro',
                    type: 'hero',
                  },
                  {
                    points: ['A1', 'A2'],
                    speakerNote: 'First point slide.',
                    title: '第一组要点',
                    type: 'three-points',
                  },
                  {
                    points: ['B1', 'B2'],
                    speakerNote: 'Second point slide.',
                    title: '建立验证链',
                    type: 'three-points',
                  },
                  {
                    points: ['C1', 'C2'],
                    speakerNote: 'Third point slide.',
                    title: '质量评分',
                    type: 'three-points',
                  },
                  {
                    points: ['D1', 'D2'],
                    speakerNote: 'Fourth point slide.',
                    title: '执行动作',
                    type: 'three-points',
                  },
                ],
              }),
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient,
        projectId: 'deck-template-diversity-demo',
        workspaceDir: root,
      })
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {slides: Array<{type: string}>}

      expect(deck.slides.map((slide) => slide.type)).to.deep.equal(['hero', 'three-points', 'timeline', 'summary', 'process'])
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('repairs missing LLM speaker notes before creating speaker script segments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-missing-note-'))
    const inputPath = join(root, 'notes.md')

    try {
      await writeFile(inputPath, '# Missing Note\n\nShow the generated visible points.')

      const result = await createDeckExplainerProject({
        inputPath,
        llmClient: {
          async generateObject(input) {
            return {
              object: input.schema.parse({
                summary: 'Missing notes should be repaired from generated slide content.',
                title: 'Missing Note Deck',
                slides: [
                  {
                    points: ['Visible point one', 'Visible point two'],
                    title: 'Generated slide',
                    type: 'three-points',
                  },
                ],
              }),
            }
          },
          async generateText() {
            throw new Error('Not used by this test.')
          },
          streamText() {
            throw new Error('Not used by this test.')
          },
        } satisfies LLMClient,
        projectId: 'deck-missing-note-demo',
        workspaceDir: root,
      })
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {slides: Array<{speakerNote?: string}>}
      const speakerScript = JSON.parse(await readFile(result.artifacts.speakerScript, 'utf8')) as {segments: Array<{text: string}>}

      expect(deck.slides[0]?.speakerNote).to.equal('Generated slide。Visible point one。Visible point two')
      expect(speakerScript.segments[0]?.text).to.equal('Generated slide。Visible point one。Visible point two')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('synthesizes Deck voiceover, renders final video, and updates timed DeckIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-voice-'))
    const inputPath = join(root, 'notes.md')

    try {
      await writeFile(
        inputPath,
        [
          '视频 Agent 应该拆成两条业务 pipeline。',
          '',
          '电影解说围绕原片片段组织，PPT 讲解围绕内容结构组织。',
        ].join('\n'),
      )
      await createDeckExplainerProject({
        inputPath,
        llmClient: createDeckPlanningLLMClient(),
        maxSlideCharacters: 30,
        projectId: 'deck-voice-demo',
        slideSeconds: 12,
        workspaceDir: root,
      })

      const result = await createDeckVoiceoverProject({
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })
      const chromiumCommand = await createFakeChromiumCommand(root)
      const timedDeck = JSON.parse(await readFile(result.artifacts.timedDeck, 'utf8')) as {
        audioRef?: string
        timings: Array<{end: number; slideId: string; start: number}>
      }
      const deckVoiceover = JSON.parse(await readFile(result.artifacts.deckVoiceover, 'utf8')) as {
        outputPath: string
        segments: Array<{duration: number; path: string; slideId: string; start: number}>
      }
      const narration = JSON.parse(await readFile(result.artifacts.narration, 'utf8')) as {
        segments: Array<{duration: number; start: number}>
      }

      expect(result.status).to.equal('voiced')
      expect(result.slides).to.equal(timedDeck.timings.length)
      expect(timedDeck.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(deckVoiceover.outputPath).to.equal('audio/deck_voiceover.wav')
      expect(deckVoiceover.segments.length).to.equal(result.slides)
      expect(deckVoiceover.segments[0]?.start).to.equal(0)
      expect(deckVoiceover.segments.map((segment) => segment.slideId)).to.deep.equal(timedDeck.timings.map((timing) => timing.slideId))
      expect(narration.segments.map((segment) => segment.start)).to.deep.equal(timedDeck.timings.map((timing) => timing.start))
      expect(narration.segments.map((segment) => segment.duration)).to.deep.equal(timedDeck.timings.map((timing) => timing.end - timing.start))
      expect((await stat(result.outputPath)).size).to.be.greaterThan(44)

      const playwrightPath = join(root, 'fake-playwright-keyframes.ts')
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
      const render = await createDeckFinalRenderProject({
        chromiumCommand,
        frameConcurrency: 2,
        playwrightCommand: ['bun', playwrightPath],
        projectId: 'deck-voice-demo',
        renderer: 'html',
        workspaceDir: root,
      })
      const renderOutput = JSON.parse(await readFile(render.artifactPath, 'utf8')) as {
        audioInputs: number
        audioPath: string
        entryHtml: string
        finalized: boolean
        frameCapturedCount: number
        frameConcurrency: number
        frameEnd: number
        frameFps: number
        frameManifestPath: string
        framePattern: string
        frameReuse: boolean
        frameRenderer: string
        frameSkippedCount: number
        frameStart: number
        frameCount: number
        keyframeQualityPath: string
        keyframeRenderer: string
        outputDir: string
        outputPath: string
        outputQuality: {audioStreams: number; subtitleStreams: number; videoStreams: number}
        planPath: string
        renderer: string
        runtimePath: string
        silentVideoPath: string
        stylesPath: string
        subtitlePath: string
        subtitleQuality: {errors: number; warnings: number}
        subtitleMuxed: boolean
        subtitleMuxMode: string
        subtitlesBurned: boolean
        videoRenderer: string
        visualQuality: {
          errors: number
          frameSamples: Array<{ok: boolean; path?: string; sha256?: string; size?: number; timestamp: number}>
          warnings: number
        }
      }
      const frameManifest = JSON.parse(await readFile(render.frameManifestPath, 'utf8')) as {
        concurrency: number
        fps: number
        frameCount: number
        frames: Array<{frame: number; path: string; slideId: string; time: number}>
        pattern: string
        renderer: string
        sourceSha256: string
      }
      const keyframes = JSON.parse(await readFile(join(root, 'projects', 'deck-voice-demo', 'artifacts', 'deck-keyframes.json'), 'utf8')) as {
        captureMode: string
        renderer: string
        samples: Array<{frame: number; ok: boolean; path: string; sha256?: string; size?: number; slideId: string; time: number}>
        source: string
      }
      const subtitles = JSON.parse(await readFile(join(root, 'projects', 'deck-voice-demo', 'artifacts', 'subtitles.json'), 'utf8')) as {
        cues: number
        format: string
        path: string
      }
      const deckQuality = JSON.parse(await readFile(render.deckQualityReportPath, 'utf8')) as {
        format: string
        metrics: Array<{duration: number; slideId: string; textCharacters: number}>
        source: string
        summary: {errors: number; slides: number}
      }

      expect(render.status).to.equal('rendered')
      expect(render.renderer).to.equal('html')
      expect(render.frameRenderer).to.equal('playwright')
      expect(render.videoRenderer).to.equal('playwright+ffmpeg')
      expect(render.frameCount).to.be.greaterThan(result.slides)
      expect(render.subtitleQuality.errors).to.equal(0)
      expect(render.htmlOutputDir.endsWith('renders/html')).to.equal(true)
      expect(render.htmlEntryPath.endsWith('renders/html/index.html')).to.equal(true)
      expect((await stat(render.outputPath)).size).to.be.greaterThan(0)
      expect((await stat(render.htmlEntryPath)).size).to.be.greaterThan(0)
      expect((await stat(render.subtitlePath)).size).to.be.greaterThan(0)
      expect(renderOutput).to.deep.include({
        audioInputs: 1,
        audioPath: 'audio/deck_voiceover.wav',
        entryHtml: 'renders/html/index.html',
        finalized: true,
        frameCapturedCount: render.frameCount,
        frameConcurrency: 2,
        frameEnd: render.frameCount,
        frameFps: 30,
        frameManifestPath: 'artifacts/deck-frame-manifest.json',
        framePattern: 'renders/deck-frames/frame-%06d.png',
        frameReuse: false,
        frameRenderer: 'playwright',
        frameSkippedCount: 0,
        frameStart: 1,
        keyframeQualityPath: 'artifacts/deck-keyframes.json',
        keyframeRenderer: 'playwright',
        outputDir: 'renders/html',
        outputPath: 'renders/final.mp4',
        planPath: 'renders/html/deck-render-plan.json',
        renderer: 'html',
        runtimePath: 'renders/html/runtime.js',
        silentVideoPath: 'renders/deck_silent.mp4',
        stylesPath: 'renders/html/styles.css',
        subtitleMuxMode: 'mov_text',
        subtitleMuxed: true,
        subtitlePath: 'renders/subtitles.srt',
        subtitlesBurned: false,
        videoRenderer: 'playwright+ffmpeg',
      })
      expect(renderOutput.outputQuality.videoStreams).to.equal(1)
      expect(renderOutput.outputQuality.audioStreams).to.equal(1)
      expect(renderOutput.outputQuality.subtitleStreams).to.equal(1)
      expect(renderOutput.visualQuality.errors).to.equal(0)
      expect(renderOutput.visualQuality.frameSamples.length).to.be.greaterThan(1)
      expect(renderOutput.visualQuality.frameSamples.every((sample) => sample.ok && typeof sample.path === 'string' && typeof sample.sha256 === 'string' && (sample.size ?? 0) > 0)).to.equal(true)
      expect(renderOutput.subtitleQuality.errors).to.equal(0)
      expect(frameManifest.renderer).to.equal('playwright')
      expect(frameManifest.concurrency).to.equal(2)
      expect(frameManifest.fps).to.equal(30)
      expect(frameManifest.frameCount).to.equal(render.frameCount)
      expect(frameManifest.pattern).to.equal('renders/deck-frames/frame-%06d.png')
      expect(frameManifest.sourceSha256).to.have.length(64)
      expect(frameManifest.frames[0]).to.deep.include({frame: 1, path: 'renders/deck-frames/frame-000001.png', time: 0})
      expect(frameManifest.frames.length).to.equal(render.frameCount)
      expect(keyframes.captureMode).to.equal('browser-keyframes')
      expect(keyframes.renderer).to.equal('playwright')
      expect(keyframes.source).to.equal('deck-frame-manifest.json')
      expect(keyframes.samples.length).to.equal(renderOutput.visualQuality.frameSamples.length)
      expect(keyframes.samples[0]).to.deep.include({frame: 1, ok: true, path: 'renders/deck-keyframes/keyframe-000001.png', time: 0})
      expect(keyframes.samples.every((sample) => typeof sample.sha256 === 'string' && (sample.size ?? 0) > 0)).to.equal(true)
      expect(subtitles.format).to.equal('srt')
      expect(subtitles.path).to.equal('renders/subtitles.srt')
      expect(subtitles.cues).to.be.greaterThan(0)
      expect(deckQuality.source).to.equal('timed-deck.json')
      expect(deckQuality.format).to.equal('portrait_1080x1920')
      expect(deckQuality.summary.errors).to.equal(0)
      expect(deckQuality.summary.slides).to.equal(result.slides)
      expect(deckQuality.metrics.length).to.equal(result.slides)
      expect(deckQuality.metrics.every((metric) => metric.duration > 0 && metric.textCharacters > 0)).to.equal(true)
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)
      expect((await readProjectVisualSamples('deck-voice-demo', {workspaceDir: root})).samples.length).to.equal(keyframes.samples.length)

      const shardPlan = await createDeckFrameShardPlanProject({
        frameShardSize: 2,
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })
      const shardPlanOutput = JSON.parse(await readFile(shardPlan.artifactPath, 'utf8')) as {
        completeShards: number
        finalizeArgs: string[]
        frameManifestPath: string
        frameShardSize: number
        pendingShards: number
        shards: Array<{
          commandArgs: string[]
          frameEnd: number
          frameStart: number
          missingFrames: number
          status: string
        }>
      }

      expect(shardPlan.status).to.equal('planned')
      expect(shardPlan.frameShardSize).to.equal(2)
      expect(shardPlan.shards[0]?.commandArgs).to.deep.equal(['deck', 'render', 'deck-voice-demo', '--frame-start', '1', '--frame-end', '2', '--frame-capture-backend', 'playwright'])
      expect(shardPlanOutput.frameManifestPath).to.equal('artifacts/deck-frame-manifest.json')
      expect(shardPlanOutput.frameShardSize).to.equal(2)
      expect(shardPlanOutput.finalizeArgs).to.deep.equal(['deck', 'render', 'deck-voice-demo', '--finalize-only'])
      expect(shardPlanOutput.pendingShards).to.equal(0)
      expect(shardPlanOutput.completeShards).to.equal(shardPlanOutput.shards.length)
      expect(shardPlanOutput.shards[0]?.status).to.equal('complete')
      expect(shardPlanOutput.shards[0]?.missingFrames).to.equal(0)
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)

      const failingChromiumPath = join(root, 'failing-chromium.ts')
      await writeFile(failingChromiumPath, 'process.exit(19)\n')

      const shardBatch = await createDeckFrameShardBatchProject({
        chromiumCommand: ['bun', failingChromiumPath],
        frameShardSize: 2,
        projectId: 'deck-voice-demo',
        shardConcurrency: 2,
        workspaceDir: root,
      })
      const shardBatchOutput = JSON.parse(await readFile(shardBatch.artifactPath, 'utf8')) as {
        completedShards: number
        failedShards: number
        frameCapturedCount: number
        frameCount: number
        frameSkippedCount: number
        htmlOutputDir: string
        shardConcurrency: number
        status: string
      }

      expect(shardBatch.status).to.equal('completed')
      expect(shardBatch.completedShards).to.equal(shardBatch.shardCount)
      expect(shardBatch.failedShards).to.equal(0)
      expect(shardBatch.frameCapturedCount).to.equal(0)
      expect(shardBatch.frameSkippedCount).to.equal(shardBatch.frameCount)
      expect(shardBatch.shardConcurrency).to.equal(2)
      expect(shardBatchOutput.status).to.equal('completed')
      expect(shardBatchOutput.htmlOutputDir).to.equal('renders/html-shards')
      expect(shardBatchOutput.frameCapturedCount).to.equal(0)
      expect(shardBatchOutput.frameSkippedCount).to.equal(shardBatchOutput.frameCount)
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)

      await rm(join(root, 'projects', 'deck-voice-demo', 'renders', 'deck-frames', 'frame-000001.png'), {force: true})

      const flakyChromiumPath = join(root, 'flaky-chromium.ts')
      const flakyStatePath = join(root, 'flaky-chromium-state.json')
      await writeFile(
        flakyChromiumPath,
        [
          `const statePath = ${JSON.stringify(flakyStatePath)}`,
          'let attempts = 0',
          'try { attempts = (await Bun.file(statePath).json()).attempts } catch {}',
          'await Bun.write(statePath, JSON.stringify({attempts: attempts + 1}))',
          'if (attempts === 0) process.exit(23)',
          'const screenshotArg = Bun.argv.find((arg) => arg.startsWith("--screenshot="))',
          'if (screenshotArg === undefined) process.exit(2)',
          'const outputPath = screenshotArg.slice("--screenshot=".length)',
          "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8//8/AwMDCwMYAAAkFAMDuxa40wAAAABJRU5ErkJggg==', 'base64')",
          'await Bun.write(outputPath, png)',
          '',
        ].join('\n'),
      )
      const retriedBatch = await createDeckFrameShardBatchProject({
        chromiumCommand: ['bun', flakyChromiumPath],
        frameCaptureBackend: 'chromium',
        frameShardSize: 2,
        projectId: 'deck-voice-demo',
        shardRetries: 1,
        workspaceDir: root,
      })
      const retriedBatchOutput = JSON.parse(await readFile(retriedBatch.artifactPath, 'utf8')) as {
        failedShards: number
        frameCapturedCount: number
        shardRetries: number
        shards: Array<{attempts: number; frameStart: number; status: string}>
      }

      expect(retriedBatch.status).to.equal('completed')
      expect(retriedBatch.failedShards).to.equal(0)
      expect(retriedBatch.frameCapturedCount).to.equal(1)
      expect(retriedBatch.shardRetries).to.equal(1)
      expect(retriedBatch.shards.find((shard) => shard.frameStart === 1)?.attempts).to.equal(2)
      expect(retriedBatchOutput.failedShards).to.equal(0)
      expect(retriedBatchOutput.frameCapturedCount).to.equal(1)
      expect(retriedBatchOutput.shardRetries).to.equal(1)
      expect(retriedBatchOutput.shards.find((shard) => shard.frameStart === 1)?.attempts).to.equal(2)
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)

      const remotionProject = await createDeckRendererBackendProject({
        backend: 'remotion',
        compositionId: 'DeckDemo',
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })
      const remotionArtifact = JSON.parse(await readFile(remotionProject.artifactPath, 'utf8')) as {
        backend: string
        files: {composition: string; data: string; motion: string; package: string}
        motionTrackCount: number
        renderCommand: string[]
      }

      expect(remotionProject.status).to.equal('exported')
      expect(remotionProject.backend).to.equal('remotion')
      expect(remotionArtifact.backend).to.equal('remotion')
      expect(remotionArtifact.files.composition).to.equal('renders/remotion/src/DeckComposition.tsx')
      expect(remotionArtifact.renderCommand).to.deep.equal(['bun', 'run', 'render'])
      expect(remotionArtifact.motionTrackCount).to.be.greaterThan(0)
      expect((await stat(remotionProject.files.package)).size).to.be.greaterThan(0)
      expect((await stat(remotionProject.files.motion)).size).to.be.greaterThan(0)
      expect(await readFile(remotionProject.files.composition, 'utf8')).to.contain('DeckDemo')
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)

      const remotionRenderCommandPath = join(root, 'fake-remotion-render.ts')
      await writeFile(
        remotionRenderCommandPath,
        [
          "await Bun.$`mkdir -p out`",
          "await Bun.write('out/final.mp4', 'fake remotion video')",
          '',
        ].join('\n'),
      )
      const remotionRender = await createDeckRemotionRenderProject({
        command: ['bun', remotionRenderCommandPath],
        compositionId: 'DeckDemoRender',
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })
      const remotionRenderArtifact = JSON.parse(await readFile(remotionRender.artifactPath, 'utf8')) as {
        backend: string
        exportArtifactPath: string
        outputPath: string
      }

      expect(remotionRender.status).to.equal('rendered')
      expect(remotionRender.backend).to.equal('remotion')
      expect((await stat(remotionRender.outputPath)).size).to.be.greaterThan(0)
      expect(remotionRenderArtifact.backend).to.equal('remotion')
      expect(remotionRenderArtifact.exportArtifactPath).to.equal('artifacts/deck-renderer-remotion.json')
      expect(remotionRenderArtifact.outputPath).to.equal('renders/remotion/out/final.mp4')
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)

      const motionCanvasProject = await createDeckRendererBackendProject({
        backend: 'motion-canvas',
        fps: 24,
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })
      const motionCanvasArtifact = JSON.parse(await readFile(motionCanvasProject.artifactPath, 'utf8')) as {
        backend: string
        files: {project: string; scene: string}
        fps: number
        renderCommand: string[]
      }

      expect(motionCanvasProject.status).to.equal('exported')
      expect(motionCanvasProject.backend).to.equal('motion-canvas')
      expect(motionCanvasProject.fps).to.equal(24)
      expect(motionCanvasArtifact.backend).to.equal('motion-canvas')
      expect(motionCanvasArtifact.fps).to.equal(24)
      expect(motionCanvasArtifact.files.project).to.equal('renders/motion-canvas/src/project.ts')
      expect(motionCanvasArtifact.renderCommand).to.deep.equal(['bun', 'run', 'render'])
      expect((await stat(motionCanvasProject.files.project)).size).to.be.greaterThan(0)
      expect((await stat(motionCanvasProject.files.scene)).size).to.be.greaterThan(0)
      expect(await readFile(motionCanvasProject.files.project, 'utf8')).to.contain('fps: 24')
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)

      const shard = await createDeckFinalRenderProject({
        chromiumCommand,
        frameCaptureBackend: 'chromium',
        frameEnd: 2,
        frameStart: 1,
        projectId: 'deck-voice-demo',
        renderer: 'html',
        workspaceDir: root,
      })
      const shardOutput = JSON.parse(await readFile(shard.artifactPath, 'utf8')) as {
        finalized: boolean
        frameEnd: number
        frameStart: number
        frames: Array<{frame: number; path: string}>
      }

      expect(shard.status).to.equal('frames-rendered')
      expect(shard.finalized).to.equal(false)
      expect(shard.frameStart).to.equal(1)
      expect(shard.frameEnd).to.equal(2)
      expect(shard.artifactPath).to.contain('deck-frame-shard-000001-000002.json')
      expect(shardOutput.finalized).to.equal(false)
      expect(shardOutput.frameStart).to.equal(1)
      expect(shardOutput.frameEnd).to.equal(2)
      expect(shardOutput.frames.map((frame) => frame.frame)).to.deep.equal([1, 2])
      expect((await verifyProjectArtifacts('deck-voice-demo', root)).ok).to.equal(true)

      const resumedRender = await createDeckFinalRenderProject({
        chromiumCommand: ['bun', failingChromiumPath],
        projectId: 'deck-voice-demo',
        renderer: 'html',
        workspaceDir: root,
      })
      const resumedOutput = JSON.parse(await readFile(resumedRender.artifactPath, 'utf8')) as {
        frameCapturedCount: number
        frameCount: number
        frameReuse: boolean
        frameSkippedCount: number
      }

      expect(resumedOutput.frameReuse).to.equal(true)
      expect(resumedOutput.frameCapturedCount).to.equal(0)
      expect(resumedOutput.frameSkippedCount).to.equal(resumedOutput.frameCount)
      expect(resumedRender.frameCount).to.equal(render.frameCount)
      expect((await stat(resumedRender.outputPath)).size).to.be.greaterThan(0)

      const finalizedFromFrames = await createDeckFinalRenderProject({
        chromiumCommand: ['bun', failingChromiumPath],
        finalizeOnly: true,
        projectId: 'deck-voice-demo',
        renderer: 'html',
        workspaceDir: root,
      })
      const finalizedFromFramesOutput = JSON.parse(await readFile(finalizedFromFrames.artifactPath, 'utf8')) as {
        finalizeOnly: boolean
        frameCapturedCount: number
        frameCount: number
        frameSkippedCount: number
        outputQuality: {subtitleStreams: number}
      }

      expect(finalizedFromFrames.status).to.equal('rendered')
      expect(finalizedFromFrames.finalized).to.equal(true)
      expect(finalizedFromFramesOutput.finalizeOnly).to.equal(true)
      expect(finalizedFromFramesOutput.frameCapturedCount).to.equal(0)
      expect(finalizedFromFramesOutput.frameSkippedCount).to.equal(finalizedFromFramesOutput.frameCount)
      expect(finalizedFromFramesOutput.outputQuality.subtitleStreams).to.equal(1)

      const htmlRendererScript = join(root, 'fake-html-renderer.ts')
      const htmlCapturePath = join(root, 'deck-html-capture.mp4')

      await writeFile(
        htmlRendererScript,
        [
          "const args = Bun.argv.slice(2)",
          "if (args[0] === 'validate') {",
          "  const projectDir = args[1]",
          "  await Bun.file(`${projectDir}/index.html`).text()",
          "  console.log('validated')",
          "  process.exit(0)",
          "}",
          "if (args[0] === 'render') {",
          "  const outputIndex = args.indexOf('--output')",
          "  const outputPath = args[outputIndex + 1]",
          "  await Bun.write(outputPath, 'fake capture')",
          "  console.log('rendered')",
          "  process.exit(0)",
          "}",
          "process.exit(2)",
          '',
        ].join('\n'),
      )

      const capturedRender = await createDeckFinalRenderProject({
        chromiumCommand,
        htmlOutput: htmlCapturePath,
        htmlRender: true,
        htmlRenderCommand: ['bun', htmlRendererScript],
        htmlValidate: true,
        projectId: 'deck-voice-demo',
        renderer: 'html',
        workspaceDir: root,
      })
      const capturedOutput = JSON.parse(await readFile(capturedRender.artifactPath, 'utf8')) as {
        reviewHtmlPath: string
        reviewReportPath: string
        rendered?: {command: string[]; stdout: string}
        validation?: {command: string[]; stdout: string}
      }
      const reviewReport = JSON.parse(await readFile(join(root, 'projects', 'deck-voice-demo', 'artifacts', 'review-report.json'), 'utf8')) as {
        reviewHtmlPath: string
        slides: Array<{keyframe?: {path: string}; slideId: string}>
        summary: {keyframes: number; slides: number}
      }

      expect(capturedRender.rendered?.stdout).to.contain('rendered')
      expect(capturedRender.validation?.stdout).to.contain('validated')
      expect(capturedOutput.rendered?.command).to.deep.equal(['bun', htmlRendererScript, 'render', capturedRender.htmlOutputDir, '--output', htmlCapturePath])
      expect(capturedOutput.validation?.command).to.deep.equal(['bun', htmlRendererScript, 'validate', capturedRender.htmlOutputDir])
      expect(capturedOutput.reviewHtmlPath).to.equal('renders/review/index.html')
      expect(capturedOutput.reviewReportPath).to.equal('artifacts/review-report.json')
      expect(capturedRender.reviewHtmlPath).to.equal(join(root, 'projects', 'deck-voice-demo', 'renders', 'review', 'index.html'))
      expect(capturedRender.reviewReportPath).to.equal(join(root, 'projects', 'deck-voice-demo', 'artifacts', 'review-report.json'))
      expect(reviewReport.reviewHtmlPath).to.equal('renders/review/index.html')
      expect(reviewReport.summary.slides).to.equal(reviewReport.slides.length)
      expect(reviewReport.summary.keyframes).to.be.greaterThan(0)
      expect(reviewReport.slides[0]?.keyframe?.path).to.match(/^renders\/(?:deck-frames\/frame|deck-keyframes\/keyframe)-\d{6}\.(?:jpg|png)$/)
      expect(await readFile(join(root, 'projects', 'deck-voice-demo', 'renders', 'review', 'index.html'), 'utf8')).to.contain('Deck Review')
      expect((await stat(htmlCapturePath)).size).to.be.greaterThan(0)

      const exported = await exportProject({
        outputPath: join(root, 'deck-final.mp4'),
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })

      expect(exported.format).to.equal('video')
      expect((await stat(exported.outputPath)).size).to.be.greaterThan(0)

      const verification = await verifyProjectArtifacts('deck-voice-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)

      const shardOnlyRender = await createDeckFinalRenderProject({
        finalize: false,
        frameEnd: 1,
        frameStart: 1,
        projectId: 'deck-voice-demo',
        renderer: 'html',
        workspaceDir: root,
      })

      expect(shardOnlyRender.finalized).to.equal(false)
      expect(await Bun.file(join(root, 'projects', 'deck-voice-demo', 'artifacts', 'review-report.json')).exists()).to.equal(false)
      expect(await Bun.file(join(root, 'projects', 'deck-voice-demo', 'renders', 'review', 'index.html')).exists()).to.equal(false)

      await rm(join(root, 'projects', 'deck-voice-demo', 'renders', 'deck-frames', 'frame-000001.png'), {force: true})

      let missingFrameError: Error | undefined
      try {
        await createDeckFinalRenderProject({
          finalizeOnly: true,
          projectId: 'deck-voice-demo',
          renderer: 'html',
          workspaceDir: root,
        })
      } catch (error) {
        missingFrameError = error instanceof Error ? error : new Error(String(error))
      }

      expect(missingFrameError).to.be.instanceOf(Error)
      expect(missingFrameError?.message).to.contain('Deck frame sequence is incomplete')
      expect(missingFrameError?.message).to.contain('frame-000001.png')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates Deck voiceover when an unused VLM provider is backed by configured LLM', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-voice-llm-'))
    const inputPath = join(root, 'notes.md')

    try {
      await writeConfig(root, {
        asr: 'mock',
        llm: {
          apiKeyEnv: 'VIDEO_AGENT_LLM_TOKEN',
          baseURL: 'https://llm.example.test/v1',
          model: 'test-model',
          provider: 'openai-compatible',
        },
        tts: 'mock',
        vlm: 'llm',
      })
      await writeFile(inputPath, 'Deck voiceover only needs TTS, but the provider set still includes VLM.')
      await createDeckExplainerProject({
        inputPath,
        llmClient: createDeckPlanningLLMClient(),
        maxSlideCharacters: 40,
        projectId: 'deck-voice-llm-demo',
        workspaceDir: root,
      })

      const result = await createDeckVoiceoverProject({
        projectId: 'deck-voice-llm-demo',
        workspaceDir: root,
      })

      expect(result.status).to.equal('voiced')
      expect(result.slides).to.be.greaterThan(0)
      expect((await stat(result.outputPath)).size).to.be.greaterThan(44)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates an audio-anchored Deck project that preserves original audio timing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-audio-'))
    const inputPath = join(root, 'podcast.wav')

    try {
      await createSampleAudio(inputPath)

      const result = await createDeckAudioAnchoredProject({
        inputPath,
        llmClient: createDeckPlanningLLMClient(),
        maxSlideCharacters: 45,
        projectId: 'deck-audio-demo',
        slideSeconds: 1,
        title: 'Audio Anchored Deck',
        workspaceDir: root,
      })
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {inputMode: string; slides: Array<{slideId: string}>}
      const claims = JSON.parse(await readFile(result.artifacts.claims, 'utf8')) as {claims: Array<{evidence: unknown[]; type: string}>}
      const sourceQuotes = JSON.parse(await readFile(result.artifacts.sourceQuotes, 'utf8')) as {quotes: Array<{evidence: unknown[]}>}
      const transcript = JSON.parse(await readFile(result.artifacts.transcript, 'utf8')) as {text: string}
      const timedDeck = JSON.parse(await readFile(result.artifacts.timedDeck, 'utf8')) as {audioRef?: string; timings: Array<{end: number; start: number}>}
      const deckVoiceover = JSON.parse(await readFile(result.artifacts.deckVoiceover, 'utf8')) as {outputPath: string}

      expect(result.status).to.equal('completed')
      expect(result.duration).to.be.greaterThan(0)
      expect(result.outputPath.endsWith('audio/deck_voiceover.wav')).to.equal(true)
      expect(deck.inputMode).to.equal('audio-anchored')
      expect(deck.slides.length).to.equal(result.slides)
      expect(claims.claims.every((claim) => claim.evidence.length > 0)).to.equal(true)
      expect(sourceQuotes.quotes.length).to.be.greaterThan(0)
      expect(sourceQuotes.quotes.every((quote) => quote.evidence.length > 0)).to.equal(true)
      expect(transcript.text).to.contain('Mock transcript')
      expect(timedDeck.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(timedDeck.timings[0]?.start).to.equal(0)
      expect(timedDeck.timings.at(-1)?.end).to.equal(result.duration)
      expect(deckVoiceover.outputPath).to.equal('audio/deck_voiceover.wav')
      expect((await stat(result.outputPath)).size).to.be.greaterThan(44)

      const render = await createDeckFinalRenderProject({
        chromiumCommand: await createFakeChromiumCommand(root),
        frameCaptureBackend: 'chromium',
        keyframeCaptureBackend: 'chromium',
        projectId: 'deck-audio-demo',
        renderer: 'html',
        workspaceDir: root,
      })

      expect(render.status).to.equal('rendered')
      expect((await stat(render.outputPath)).size).to.be.greaterThan(0)

      const exported = await exportProject({
        outputPath: join(root, 'deck-audio.mp4'),
        projectId: 'deck-audio-demo',
        workspaceDir: root,
      })

      expect(exported.format).to.equal('video')
      expect((await stat(exported.outputPath)).size).to.be.greaterThan(0)

      const verification = await verifyProjectArtifacts('deck-audio-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('creates a summarized Deck project from audio and then synthesizes a new voiceover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-summary-'))
    const inputPath = join(root, 'podcast.wav')

    try {
      await createSampleAudio(inputPath)

      const result = await createDeckSummarizeProject({
        durationTargetSeconds: 2,
        inputPath,
        llmClient: createDeckPlanningLLMClient(),
        maxSlideCharacters: 45,
        projectId: 'deck-summary-demo',
        slideSeconds: 1,
        title: 'Podcast Summary',
        workspaceDir: root,
      }) as Awaited<ReturnType<typeof createDeckSummarizeProject>> & {artifacts: {claims: string; sourceQuotes: string; transcript: string}; sourceMode: 'audio-summary'}
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {inputMode: string; slides: Array<{slideId: string}>}
      const claims = JSON.parse(await readFile(result.artifacts.claims, 'utf8')) as {claims: Array<{evidence: unknown[]}>}
      const sourceQuotes = JSON.parse(await readFile(result.artifacts.sourceQuotes, 'utf8')) as {quotes: Array<{evidence: unknown[]}>}
      const document = JSON.parse(await readFile(result.artifacts.document, 'utf8')) as {source: {sourceType: string}}
      const transcript = JSON.parse(await readFile(result.artifacts.transcript, 'utf8')) as {text: string}
      const speakerScript = JSON.parse(await readFile(result.artifacts.speakerScript, 'utf8')) as {mode: string}

      expect(result.status).to.equal('completed')
      expect(result.slides).to.be.greaterThan(0)
      expect(result.sourceMode).to.equal('audio-summary')
      expect(deck.inputMode).to.equal('script-generated')
      expect(document.source.sourceType).to.equal('audio')
      expect(claims.claims.length).to.be.greaterThan(0)
      expect(claims.claims.every((claim) => claim.evidence.length > 0)).to.equal(true)
      expect(sourceQuotes.quotes.every((quote) => quote.evidence.length > 0)).to.equal(true)
      expect(transcript.text).to.contain('Mock transcript')
      expect(speakerScript.mode).to.equal('script-generated')

      const voice = await createDeckVoiceoverProject({
        projectId: 'deck-summary-demo',
        workspaceDir: root,
      })

      expect(voice.status).to.equal('voiced')
      expect(voice.duration).to.be.greaterThan(0)
      expect((await stat(voice.outputPath)).size).to.be.greaterThan(44)

      const render = await createDeckFinalRenderProject({
        chromiumCommand: await createFakeChromiumCommand(root),
        frameCaptureBackend: 'chromium',
        keyframeCaptureBackend: 'chromium',
        projectId: 'deck-summary-demo',
        renderer: 'html',
        workspaceDir: root,
      })

      expect(render.status).to.equal('rendered')
      expect((await stat(render.outputPath)).size).to.be.greaterThan(0)

      const verification = await verifyProjectArtifacts('deck-summary-demo', root)

      expect(verification.ok).to.equal(true)
      expect(verification.checked).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function createSampleAudio(inputPath: string): Promise<void> {
  const result = await runProcess([
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

  if (result.code !== 0) {
    throw new Error(result.stderr)
  }
}

async function createFakeChromiumCommand(root: string): Promise<string[]> {
  const scriptPath = join(root, 'fake-chromium.ts')

  await writeFile(
    scriptPath,
    [
      'const screenshotArg = Bun.argv.find((arg) => arg.startsWith("--screenshot="))',
      'if (screenshotArg === undefined) {',
      '  console.error("missing screenshot output")',
      '  process.exit(2)',
      '}',
      'const outputPath = screenshotArg.slice("--screenshot=".length)',
      "const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAE0lEQVR4nGP8//8/AwMDCwMYAAAkFAMDuxa40wAAAABJRU5ErkJggg==', 'base64')",
      'await Bun.write(outputPath, png)',
      '',
    ].join('\n'),
  )

  return ['bun', scriptPath]
}

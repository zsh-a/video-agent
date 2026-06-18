import {expect} from '#test/expect'
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GenerateObjectRequest, LLMClient} from '../../../packages/llm/src/index.js'

import {runProcess} from '../../../packages/media/src/process.js'
import {exportProject} from '../../../packages/runtime/src/export.js'
import {verifyProjectArtifacts} from '../../../packages/runtime/src/artifacts.js'
import {writeConfig} from '../../../packages/runtime/src/config.js'
import {readProjectQualityDetails} from '../../../packages/runtime/src/project-quality.js'
import {renderProject} from '../../../packages/runtime/src/render-project.js'
import {createDeckAudioAnchoredProject, createDeckExplainerProject, createDeckFinalRenderProject, createDeckSummarizeProject, createDeckVoiceoverProject} from '../../../packages/runtime/src/deck-project.js'

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
  it('creates a renderable PPT-style HyperFrames project from text', async () => {
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
      expect(narration.segments.every((segment) => segment.text.startsWith('第 '))).to.equal(true)
      expect(quality.ok).to.equal(true)
      expect(quality.content).to.deep.equal({errors: 0, issues: 0, warnings: 0})

      const render = await renderProject('deck-demo', {workspaceDir: root})

      expect(render.renderer).to.equal('hyperframes')

      if (render.renderer === 'hyperframes') {
        const html = await readFile(render.entryHtml, 'utf8')

        expect(html).to.contain('Slide 1')
        expect(html).to.contain('scene__bullets')
        expect(html).to.contain('安卓开源软件推荐')
      }

      const exported = await exportProject({
        outputPath: join(root, 'out'),
        projectId: 'deck-demo',
        workspaceDir: root,
      })

      expect(exported.format).to.equal('hyperframes')
      expect((await stat(join(exported.outputPath, 'index.html'))).isFile()).to.equal(true)
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
      const prompt = JSON.parse(String(request?.messages?.[0]?.content)) as {instructions: string[]; target: {slideCount: number}}
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {slides: Array<{motion: string; points: string[]; speakerNote?: string; title: string; type: string}>; title: string}
      const document = JSON.parse(await readFile(result.artifacts.document, 'utf8')) as {text: string}
      const speakerScript = JSON.parse(await readFile(result.artifacts.speakerScript, 'utf8')) as {segments: Array<{text: string}>}

      expect(prompt.instructions.join(' ')).to.contain('Remove YAML frontmatter')
      expect(prompt.instructions.join(' ')).to.contain('controlled templates')
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
      expect(deck.slides[0]?.points).to.deep.equal(['A', 'B', 'C', 'D'])
      expect(deck.slides[0]?.motion).to.equal('cinematic-rise')
      expect(deck.slides[1]?.type).to.equal('comparison')
      expect(deck.slides[1]?.comparison?.left.points).to.deep.equal(['L1', 'L2', 'L3'])
      expect(deck.slides[1]?.comparison?.right.points).to.deep.equal(['R1', 'R2', 'R3'])
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

      const render = await createDeckFinalRenderProject({
        chromiumCommand,
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })
      const renderOutput = JSON.parse(await readFile(render.artifactPath, 'utf8')) as {
        audioInputs: number
        audioPath: string
        entryHtml: string
        frameRenderer: string
        frameCount: number
        outputDir: string
        outputPath: string
        outputQuality: {audioStreams: number; videoStreams: number}
        planPath: string
        renderer: string
        runtimePath: string
        silentVideoPath: string
        stylesPath: string
        videoRenderer: string
      }
      const deckQuality = JSON.parse(await readFile(render.deckQualityReportPath, 'utf8')) as {
        format: string
        metrics: Array<{duration: number; slideId: string; textCharacters: number}>
        source: string
        summary: {errors: number; slides: number}
      }

      expect(render.status).to.equal('rendered')
      expect(render.renderer).to.equal('html')
      expect(render.frameRenderer).to.equal('chromium')
      expect(render.videoRenderer).to.equal('chromium+ffmpeg')
      expect(render.frameCount).to.equal(result.slides)
      expect(render.htmlOutputDir.endsWith('renders/html')).to.equal(true)
      expect(render.htmlEntryPath.endsWith('renders/html/index.html')).to.equal(true)
      expect((await stat(render.outputPath)).size).to.be.greaterThan(0)
      expect((await stat(render.htmlEntryPath)).size).to.be.greaterThan(0)
      expect(renderOutput).to.deep.include({
        audioInputs: 1,
        audioPath: 'audio/deck_voiceover.wav',
        entryHtml: 'renders/html/index.html',
        frameCount: result.slides,
        frameRenderer: 'chromium',
        outputDir: 'renders/html',
        outputPath: 'renders/final.mp4',
        planPath: 'renders/html/deck-render-plan.json',
        renderer: 'html',
        runtimePath: 'renders/html/runtime.js',
        silentVideoPath: 'renders/deck_silent.mp4',
        stylesPath: 'renders/html/styles.css',
        videoRenderer: 'chromium+ffmpeg',
      })
      expect(renderOutput.outputQuality.videoStreams).to.equal(1)
      expect(renderOutput.outputQuality.audioStreams).to.equal(1)
      expect(deckQuality.source).to.equal('timed-deck.json')
      expect(deckQuality.format).to.equal('portrait_1080x1920')
      expect(deckQuality.summary.errors).to.equal(0)
      expect(deckQuality.summary.slides).to.equal(result.slides)
      expect(deckQuality.metrics.length).to.equal(result.slides)
      expect(deckQuality.metrics.every((metric) => metric.duration > 0 && metric.textCharacters > 0)).to.equal(true)

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
        workspaceDir: root,
      })
      const capturedOutput = JSON.parse(await readFile(capturedRender.artifactPath, 'utf8')) as {
        rendered?: {command: string[]; stdout: string}
        validation?: {command: string[]; stdout: string}
      }

      expect(capturedRender.rendered?.stdout).to.contain('rendered')
      expect(capturedRender.validation?.stdout).to.contain('validated')
      expect(capturedOutput.rendered?.command).to.deep.equal(['bun', htmlRendererScript, 'render', capturedRender.htmlOutputDir, '--output', htmlCapturePath])
      expect(capturedOutput.validation?.command).to.deep.equal(['bun', htmlRendererScript, 'validate', capturedRender.htmlOutputDir])
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
        projectId: 'deck-audio-demo',
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
        projectId: 'deck-summary-demo',
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
      'const ppm = new Uint8Array([',
      '  80, 54, 10, 50, 32, 50, 10, 50, 53, 53, 10,',
      '  255, 255, 255, 37, 99, 235, 15, 23, 42, 249, 115, 22,',
      '])',
      'await Bun.write(outputPath, ppm)',
      '',
    ].join('\n'),
  )

  return ['bun', scriptPath]
}

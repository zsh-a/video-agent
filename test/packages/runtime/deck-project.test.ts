import {expect} from '#test/expect'
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {runProcess} from '../../../packages/media/src/process.js'
import {exportProject} from '../../../packages/runtime/src/export.js'
import {verifyProjectArtifacts} from '../../../packages/runtime/src/artifacts.js'
import {readProjectQualityDetails} from '../../../packages/runtime/src/project-quality.js'
import {renderProject} from '../../../packages/runtime/src/render-project.js'
import {createDeckAudioAnchoredProject, createDeckExplainerProject, createDeckFinalRenderProject, createDeckSummarizeProject, createDeckVoiceoverProject} from '../../../packages/runtime/src/deck-project.js'

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
      const deck = JSON.parse(await readFile(result.artifacts.deck, 'utf8')) as {format: string; slides: Array<{slideId: string}>; theme: string}
      const document = JSON.parse(await readFile(result.artifacts.document, 'utf8')) as {blocks: Array<{id: string}>; source: {sourceType: string}}
      const claims = JSON.parse(await readFile(result.artifacts.claims, 'utf8')) as {claims: Array<{blockId: string; confidence: number; id: string; type: string}>}
      const sourceQuotes = JSON.parse(await readFile(result.artifacts.sourceQuotes, 'utf8')) as {quotes: Array<{blockId: string; text: string}>}
      const narration = JSON.parse(await readFile(result.artifacts.narration, 'utf8')) as {segments: Array<{text: string}>}
      const storyboard = JSON.parse(await readFile(result.artifacts.storyboard, 'utf8')) as {scenes: Array<{visualStyle: string}>}
      const timedDeck = JSON.parse(await readFile(result.artifacts.timedDeck, 'utf8')) as {timings: Array<{slideId: string}>}
      const quality = await readProjectQualityDetails('deck-demo', root)

      expect(result.slides).to.be.greaterThan(1)
      expect(deck.format).to.equal('portrait_1080x1920')
      expect(deck.theme).to.equal('default')
      expect(deck.slides.length).to.equal(result.slides)
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
        projectId: 'deck-voice-demo',
        workspaceDir: root,
      })
      const renderOutput = JSON.parse(await readFile(render.artifactPath, 'utf8')) as {
        audioInputs: number
        audioPath: string
        entryHtml: string
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
      expect(render.videoRenderer).to.equal('ffmpeg')
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
        outputDir: 'renders/html',
        outputPath: 'renders/final.mp4',
        planPath: 'renders/html/deck-render-plan.json',
        renderer: 'html',
        runtimePath: 'renders/html/runtime.js',
        silentVideoPath: 'renders/deck_silent.mp4',
        stylesPath: 'renders/html/styles.css',
        videoRenderer: 'ffmpeg',
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
      expect(claims.claims.length).to.be.greaterThan(0)
      expect(claims.claims.every((claim) => claim.evidence.length > 0)).to.equal(true)
      expect(sourceQuotes.quotes.every((quote) => quote.evidence.length > 0)).to.equal(true)
      expect(transcript.text).to.contain('Mock transcript')
      expect(timedDeck.audioRef).to.equal('audio/deck_voiceover.wav')
      expect(timedDeck.timings[0]?.start).to.equal(0)
      expect(timedDeck.timings.at(-1)?.end).to.equal(result.duration)
      expect(deckVoiceover.outputPath).to.equal('audio/deck_voiceover.wav')
      expect((await stat(result.outputPath)).size).to.be.greaterThan(44)

      const render = await createDeckFinalRenderProject({
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

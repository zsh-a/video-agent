import {expect} from '#test/expect'
import {readText} from '#test/fs'
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createRemotionDeckCompositionSpec, normalizeRemotionJpegQuality, renderRemotionDeckProject, writeRemotionDeckProject} from '../../../packages/renderer-remotion/src/index.js'

describe('remotion deck compiler', () => {
  it('rejects invalid render jpeg quality instead of clamping or defaulting it', () => {
    expect(normalizeRemotionJpegQuality(undefined)).to.equal(85)
    expect(normalizeRemotionJpegQuality(0)).to.equal(0)
    expect(normalizeRemotionJpegQuality(100)).to.equal(100)
    expect(() => normalizeRemotionJpegQuality(Number.NaN)).to.throw('Remotion Deck jpegQuality must be an integer between 0 and 100; no render option clamp or coercion is allowed. Received: NaN')
    expect(() => normalizeRemotionJpegQuality(100.5)).to.throw('Remotion Deck jpegQuality must be an integer between 0 and 100; no render option clamp or coercion is allowed. Received: 100.5')
    expect(() => normalizeRemotionJpegQuality(-1)).to.throw('Remotion Deck jpegQuality must be an integer between 0 and 100; no render option clamp or coercion is allowed. Received: -1')
    expect(() => normalizeRemotionJpegQuality(101)).to.throw('Remotion Deck jpegQuality must be an integer between 0 and 100; no render option clamp or coercion is allowed. Received: 101')
  })

  it('rejects empty slide timings instead of creating a minimum-duration composition', () => {
    expect(() => createRemotionDeckCompositionSpec({
      compositionId: 'DeckExplainer',
      fps: 30,
      height: 1920,
      timedDeck: {
        deck: {
          format: 'portrait_1080x1920',
          inputMode: 'script-generated',
          language: 'en',
          slides: [],
          theme: 'elegant-dark',
          title: 'Deck',
          version: 1,
        },
        timings: [],
        version: 1,
      },
      width: 1080,
    })).to.throw('no minimum-duration render fallback is allowed')
  })

  it('rejects invalid composition fps and duration instead of coercing renderer timing', () => {
    const timedDeck = {
      deck: {
        format: 'portrait_1080x1920' as const,
        inputMode: 'script-generated' as const,
        language: 'en',
        slides: [
          {
            blockIds: [],
            evidence: [],
            motion: 'slide-up' as const,
            points: [],
            slideId: 'slide-001',
            title: 'Timing',
            type: 'hero' as const,
          },
        ],
        theme: 'elegant-dark' as const,
        title: 'Deck',
        version: 1 as const,
      },
      timings: [{end: 2, slideId: 'slide-001', start: 0}],
      version: 1 as const,
    }

    expect(() => createRemotionDeckCompositionSpec({
      compositionId: 'DeckExplainer',
      fps: 29.97,
      height: 1920,
      timedDeck,
      width: 1080,
    })).to.throw('Remotion Deck renderer fps must be a positive integer; no renderer fps fallback or coercion is allowed. Received: 29.97')
    expect(() => createRemotionDeckCompositionSpec({
      compositionId: 'DeckExplainer',
      fps: 30,
      height: 1920,
      timedDeck: {
        ...timedDeck,
        timings: [{end: 0, slideId: 'slide-001', start: 0}],
      },
      width: 1080,
    })).to.throw('Remotion Deck composition requires a positive final slide timing end; no minimum-duration render fallback is allowed.')
  })

  it('rejects missing MotionIR instead of creating a static renderer fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-remotion-missing-motion-'))

    try {
      let error: unknown

      try {
        await writeRemotionDeckProject({
          outputDir: root,
          timedDeck: {
            deck: {
              format: 'portrait_1080x1920',
              inputMode: 'script-generated',
              language: 'en',
              slides: [
                {
                  blockIds: [],
                  evidence: [],
                  motion: 'slide-up',
                  points: ['Compiled motion is required'],
                  slideId: 'slide-001',
                  speakerNote: 'Renderer export should not invent static motion.',
                  title: 'No Static Motion',
                  type: 'hero',
                  visual: {assetRefs: [], kind: 'title-card'},
                },
              ],
              theme: 'elegant-dark',
              title: 'Deck',
              version: 1,
            },
            timings: [{end: 2, slideId: 'slide-001', start: 0}],
            version: 1,
          },
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('requires a compiled motionTimeline')
      expect(String(error)).to.include('no static renderer motion fallback is allowed')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('writes a Remotion project from timed DeckIR and MotionIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-remotion-'))

    try {
      const project = await writeRemotionDeckProject({
        compositionId: 'DeckExplainer',
        outputDir: root,
        timedDeck: {
          deck: {
            format: 'portrait_1080x1920',
            inputMode: 'script-generated',
            language: 'zh-CN',
            slides: [
              {
                blockIds: [],
                evidence: [],
                motion: 'slide-up',
                points: ['MotionIR 决定时间语义', 'Remotion 只负责 frame render'],
                slideId: 'slide-001',
                speakerNote: 'Remotion 后端应该消费 MotionIR。',
                title: 'Remotion 后端',
                type: 'hero',
                visual: {assetRefs: [], kind: 'title-card'},
              },
            ],
            theme: 'elegant-dark',
            title: 'Deck',
            version: 1,
          },
          timings: [
            {end: 2, slideId: 'slide-001', start: 0},
          ],
          version: 1,
        },
        motionTimeline: {
          duration: 2,
          fps: 30,
          scenes: [{end: 2, id: 'slide-001', sourceId: 'slide-001', start: 0}],
          tracks: [
            {
              duration: 0.5,
              easing: 'easeOutCubic',
              from: 0,
              id: 'title-opacity',
              property: 'opacity',
              start: 0,
              target: {kind: 'css-selector', value: '.slide-title'},
              to: 1,
            },
          ],
          version: 1,
        },
      })
      const entry = await readText(project.entryPath)
      const composition = await readText(project.compositionPath)
      const deckData = JSON.parse(await readText(project.dataPath)) as {deck: {slides: Array<{title: string}>}}
      const motion = JSON.parse(await readText(project.motionPath)) as {tracks: Array<{id: string}>}
      const packageJson = JSON.parse(await readText(project.packagePath)) as {scripts: {render: string}}

      expect(project.width).to.equal(1080)
      expect(project.height).to.equal(1920)
      expect(project.fps).to.equal(30)
      expect(await fileSize(project.packagePath)).to.be.greaterThan(0)
      expect(packageJson.scripts.render).to.contain('DeckExplainer')
      expect(entry).to.contain('registerRoot')
      expect(composition).to.contain('<Composition')
      expect(composition).to.contain("@video-agent/renderer-deck/remotion")
      expect(composition).to.contain('<DeckStageView')
      expect(composition).to.contain("import './styles.css'")
      expect(composition).to.contain('durationInFrames={60}')
      expect(await fileSize(project.stylesPath)).to.be.greaterThan(0)
      expect(deckData.deck.slides[0]?.title).to.equal('Remotion 后端')
      expect(motion.tracks[0]?.id).to.equal('title-opacity')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('runs a Remotion render command from the generated project directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-remotion-render-'))

    try {
      const commandPath = join(root, 'fake-remotion-render.ts')

      await writeFile(
        commandPath,
        [
          "await Bun.$`mkdir -p out`",
          "await Bun.write('out/final.mp4', 'fake remotion video')",
          "console.log('rendered remotion')",
          '',
        ].join('\n'),
      )
      await mkdir(join(root, 'project'), {recursive: true})

      const rendered = await renderRemotionDeckProject({
        command: ['bun', commandPath],
        projectDir: join(root, 'project'),
      })

      expect(rendered.command).to.deep.equal(['bun', commandPath])
      expect(rendered.outputPath).to.equal(join(root, 'project', 'out', 'final.mp4'))
      expect(rendered.stdout).to.contain('rendered remotion')
      expect(await fileSize(rendered.outputPath)).to.be.greaterThan(0)
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

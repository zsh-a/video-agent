import {expect} from '#test/expect'
import {readText} from '#test/fs'
import {mkdir, mkdtemp, rm, stat, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {renderRemotionDeckProject, writeRemotionDeckProject} from '../../../packages/renderer-remotion/src/index.js'

describe('remotion deck compiler', () => {
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
      expect(composition).to.contain('durationInFrames={60}')
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

import {expect} from '#test/expect'
import {readText} from '#test/fs'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {writeMotionCanvasDeckProject} from '../../../packages/renderer-motion-canvas/src/index.js'

describe('motion canvas deck compiler', () => {
  it('writes a Motion Canvas project from timed DeckIR and MotionIR', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-motion-canvas-'))

    try {
      const project = await writeMotionCanvasDeckProject({
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
                motion: 'line-draw',
                points: ['MotionIR drives timing', 'Motion Canvas renders diagram scenes'],
                slideId: 'slide-001',
                speakerNote: 'Motion Canvas is useful for technical diagrams.',
                title: 'Motion Canvas backend',
                type: 'process',
                visual: {assetRefs: [], kind: 'diagram'},
              },
            ],
            theme: 'elegant-dark',
            title: 'Deck',
            version: 1,
          },
          timings: [
            {end: 3, slideId: 'slide-001', start: 0},
          ],
          version: 1,
        },
        motionTimeline: {
          duration: 3,
          fps: 30,
          scenes: [{end: 3, id: 'slide-001', sourceId: 'slide-001', start: 0}],
          tracks: [
            {
              duration: 0.7,
              easing: 'easeOutCubic',
              from: 0,
              id: 'diagram-opacity',
              property: 'opacity',
              start: 0,
              target: {kind: 'semantic', value: 'diagram'},
              to: 1,
            },
          ],
          version: 1,
        },
      })
      const packageJson = JSON.parse(await readText(project.packagePath)) as {scripts: {render: string}}
      const deckData = JSON.parse(await readText(project.dataPath)) as {deck: {slides: Array<{title: string}>}}
      const motion = JSON.parse(await readText(project.motionPath)) as {tracks: Array<{id: string}>}
      const projectSource = await readText(project.projectPath)
      const sceneSource = await readText(project.scenePath)

      expect(project.fps).to.equal(30)
      expect(project.width).to.equal(1080)
      expect(project.height).to.equal(1920)
      expect(await fileSize(project.packagePath)).to.be.greaterThan(0)
      expect(packageJson.scripts.render).to.equal('motion-canvas render')
      expect(deckData.deck.slides[0]?.title).to.equal('Motion Canvas backend')
      expect(motion.tracks[0]?.id).to.equal('diagram-opacity')
      expect(projectSource).to.contain('makeProject')
      expect(projectSource).to.contain('fps: 30')
      expect(projectSource).to.contain('size: {x: 1080, y: 1920}')
      expect(sceneSource).to.contain('makeScene2D')
      expect(sceneSource).to.contain('motionTimeline.duration')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}

import type {DeckFormat, MotionTimeline, TimedDeck} from '@video-agent/ir'

import {MotionTimelineSchema, TimedDeckSchema} from '@video-agent/ir'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

export interface MotionCanvasDeckProject {
  dataPath: string
  fps: number
  height: number
  motionPath: string
  outputDir: string
  packagePath: string
  projectPath: string
  scenePath: string
  width: number
}

export interface WriteMotionCanvasDeckProjectOptions {
  fps?: number
  motionTimeline?: MotionTimeline
  outputDir: string
  timedDeck: TimedDeck
}

export async function writeMotionCanvasDeckProject(options: WriteMotionCanvasDeckProjectOptions): Promise<MotionCanvasDeckProject> {
  const timedDeck = TimedDeckSchema.parse(options.timedDeck)
  const fps = normalizeFps(options.fps ?? options.motionTimeline?.fps ?? 30)
  const motionTimeline = MotionTimelineSchema.parse(options.motionTimeline ?? createStaticMotionTimeline(timedDeck, fps))
  const outputDir = resolve(options.outputDir)
  const srcDir = join(outputDir, 'src')
  const sceneDir = join(srcDir, 'scenes')
  const size = motionCanvasDeckCanvasSize(timedDeck.deck.format)
  const project: MotionCanvasDeckProject = {
    dataPath: join(srcDir, 'deck-data.json'),
    fps,
    height: size.height,
    motionPath: join(srcDir, 'motion-timeline.json'),
    outputDir,
    packagePath: join(outputDir, 'package.json'),
    projectPath: join(srcDir, 'project.ts'),
    scenePath: join(sceneDir, 'deck.tsx'),
    width: size.width,
  }

  await mkdir(sceneDir, {recursive: true})
  await Promise.all([
    writeJson(project.packagePath, createMotionCanvasPackageJson()),
    writeJson(project.dataPath, timedDeck),
    writeJson(project.motionPath, motionTimeline),
    writeFile(project.projectPath, createMotionCanvasProjectSource({
      fps,
      height: size.height,
      width: size.width,
    }), 'utf8'),
    writeFile(project.scenePath, createMotionCanvasSceneSource(), 'utf8'),
  ])

  return project
}

function createStaticMotionTimeline(timedDeck: TimedDeck, fps: number): MotionTimeline {
  const duration = Math.max(0.1, timedDeck.timings.at(-1)?.end ?? 0.1)

  return MotionTimelineSchema.parse({
    duration,
    fps,
    scenes: timedDeck.timings.map((timing) => ({
      end: timing.end,
      id: timing.slideId,
      sourceId: timing.slideId,
      start: timing.start,
    })),
    tracks: [],
    version: 1,
  })
}

function createMotionCanvasPackageJson() {
  return {
    private: true,
    scripts: {
      preview: 'motion-canvas',
      render: 'motion-canvas render',
    },
    dependencies: {
      '@motion-canvas/2d': '^3.17.0',
      '@motion-canvas/core': '^3.17.0',
      '@motion-canvas/ui': '^3.17.0',
      vite: '^7.0.0',
    },
    devDependencies: {
      typescript: '^5.0.0',
    },
  }
}

function createMotionCanvasProjectSource(input: {
  fps: number
  height: number
  width: number
}): string {
  return `import {makeProject} from '@motion-canvas/core';
import deck from './scenes/deck?scene';

export default makeProject({
  scenes: [deck],
  settings: {
    shared: {
      size: {x: ${input.width}, y: ${input.height}},
      fps: ${input.fps},
    },
  },
});
`
}

function createMotionCanvasSceneSource(): string {
  return `import {Txt, makeScene2D} from '@motion-canvas/2d';
import {all, createRef, waitFor} from '@motion-canvas/core';
import deckData from '../deck-data.json';
import motionTimeline from '../motion-timeline.json';

export default makeScene2D(function* (view) {
  view.fill('#0f172a');

  const title = createRef<Txt>();
  const points = createRef<Txt>();

  view.add(
    <>
      <Txt
        ref={title}
        fill="#ffffff"
        fontFamily="Inter"
        fontSize={76}
        fontWeight={700}
        lineHeight={86}
        text={deckData.deck.slides[0]?.title ?? deckData.deck.title}
        width={900}
        y={-220}
      />
      <Txt
        ref={points}
        fill="#dbeafe"
        fontFamily="Inter"
        fontSize={34}
        lineHeight={48}
        text={(deckData.deck.slides[0]?.points ?? []).join('\\n')}
        width={840}
        y={120}
      />
    </>,
  );

  title().opacity(0);
  points().opacity(0);

  const firstOpacity = motionTimeline.tracks.find((track) => track.property === 'opacity');
  const titleDuration = firstOpacity?.duration ?? 0.5;

  yield* all(
    title().opacity(1, titleDuration),
    points().opacity(1, titleDuration + 0.2),
  );

  yield* waitFor(Math.max(0.1, motionTimeline.duration - titleDuration));
});
`
}

function normalizeFps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 30
  }

  return Math.max(1, Math.floor(value))
}

function motionCanvasDeckCanvasSize(format: DeckFormat | undefined): {height: number; width: number} {
  if (format === 'landscape_1920x1080') {
    return {height: 1080, width: 1920}
  }

  if (format === 'square_1080x1080') {
    return {height: 1080, width: 1080}
  }

  return {height: 1920, width: 1080}
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

import type {MotionTimeline, TimedDeck} from '@video-agent/ir'

import {MotionTimelineSchema, TimedDeckSchema} from '@video-agent/ir'
import {compileDeckTailwindCss, deckCanvasSize, writeDeckFontAssets} from '@video-agent/renderer-deck'
import {mkdir, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

export interface RemotionDeckProject {
  compositionId: string
  compositionPath: string
  dataPath: string
  entryPath: string
  fps: number
  height: number
  motionPath: string
  outputDir: string
  packagePath: string
  stylesPath: string
  width: number
}

export interface WriteRemotionDeckProjectOptions {
  compositionId?: string
  fps?: number
  motionTimeline?: MotionTimeline
  outputDir: string
  timedDeck: TimedDeck
}

export interface RemotionDeckCompositionSpec {
  compositionId: string
  durationInFrames: number
  fps: number
  height: number
  width: number
}

export async function writeRemotionDeckProject(options: WriteRemotionDeckProjectOptions): Promise<RemotionDeckProject> {
  const timedDeck = TimedDeckSchema.parse(options.timedDeck)
  const fps = normalizeFps(options.fps ?? options.motionTimeline?.fps ?? 30)
  const motionTimeline = MotionTimelineSchema.parse(options.motionTimeline ?? createStaticMotionTimeline(timedDeck, fps))
  const outputDir = resolve(options.outputDir)
  const srcDir = join(outputDir, 'src')
  const compositionId = options.compositionId ?? 'DeckExplainer'
  const size = deckCanvasSize(timedDeck.deck.format)
  const project: RemotionDeckProject = {
    compositionId,
    compositionPath: join(srcDir, 'DeckComposition.tsx'),
    dataPath: join(srcDir, 'deck-data.json'),
    entryPath: join(srcDir, 'index.tsx'),
    fps,
    height: size.height,
    motionPath: join(srcDir, 'motion-timeline.json'),
    outputDir,
    packagePath: join(outputDir, 'package.json'),
    stylesPath: join(srcDir, 'styles.css'),
    width: size.width,
  }
  const spec = createRemotionDeckCompositionSpec({
    compositionId,
    fps,
    height: size.height,
    timedDeck,
    width: size.width,
  })

  await mkdir(srcDir, {recursive: true})
  await writeDeckFontAssets(srcDir)
  await Promise.all([
    writeJson(project.packagePath, createRemotionPackageJson(compositionId)),
    writeJson(project.dataPath, timedDeck),
    writeJson(project.motionPath, motionTimeline),
    writeFile(project.entryPath, createRemotionEntrySource(), 'utf8'),
    writeFile(project.compositionPath, createRemotionCompositionSource(spec), 'utf8'),
  ])
  await compileDeckTailwindCss({
    deck: timedDeck.deck,
    inputPath: join(srcDir, 'tailwind.css'),
    outputPath: project.stylesPath,
    sourceHtmlPath: project.compositionPath,
  })

  return project
}

export function createRemotionDeckCompositionSpec(input: {
  compositionId: string
  fps: number
  height: number
  timedDeck: TimedDeck
  width: number
}): RemotionDeckCompositionSpec {
  const duration = Math.max(0.1, input.timedDeck.timings.at(-1)?.end ?? 0.1)

  return {
    compositionId: input.compositionId,
    durationInFrames: Math.max(1, Math.ceil(duration * input.fps)),
    fps: input.fps,
    height: input.height,
    width: input.width,
  }
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

function createRemotionPackageJson(compositionId: string) {
  return {
    private: true,
    scripts: {
      preview: 'remotion studio src/index.tsx',
      render: `remotion render src/index.tsx ${compositionId} out/final.mp4`,
    },
    dependencies: {
      '@video-agent/renderer-deck': 'workspace:*',
      '@remotion/cli': '^4.0.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      remotion: '^4.0.0',
    },
    devDependencies: {
      typescript: '^5.0.0',
    },
  }
}

function createRemotionEntrySource(): string {
  return `import {registerRoot} from 'remotion';
import {RemotionRoot} from './DeckComposition';

registerRoot(RemotionRoot);
`
}

function createRemotionCompositionSource(spec: RemotionDeckCompositionSpec): string {
  return `import type React from 'react';
import {AbsoluteFill, Composition, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {DeckStageView} from '@video-agent/renderer-deck/remotion';
import deckData from './deck-data.json';
import motionTimeline from './motion-timeline.json';
import './styles.css';

const SCENE_TRANSITION_SECONDS = 0.55;
const SCENE_ENTER_OFFSET_Y = 28;

interface DeckCompositionProps {
  deckData: typeof deckData;
  motionTimeline: typeof motionTimeline;
}

export function RemotionRoot() {
  return (
    <Composition
      id="${spec.compositionId}"
      component={DeckComposition}
      durationInFrames={${spec.durationInFrames}}
      fps={${spec.fps}}
      width={${spec.width}}
      height={${spec.height}}
      defaultProps={{deckData, motionTimeline}}
    />
  );
}

export function DeckComposition(props: DeckCompositionProps) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const time = frame / fps;
  const sceneBySlide = new Map(props.motionTimeline.scenes.map((scene, index) => [scene.sourceId, {isLast: index === props.motionTimeline.scenes.length - 1, scene}]));

  return (
    <AbsoluteFill data-deck-root data-format={props.deckData.deck.format} data-theme={props.deckData.deck.theme}>
      <DeckStageView
        deck={props.deckData.deck}
        timings={props.deckData.timings}
        slideStyle={(item) => {
          const sceneState = sceneBySlide.get(item.slide.slideId);

          return sceneState === undefined
            ? {display: 'none'}
            : sceneLayerStyle(sceneState.scene, time, sceneState.isLast);
        }}
      />
    </AbsoluteFill>
  );
}

function sceneLayerStyle(scene: typeof motionTimeline.scenes[number], time: number, isLast: boolean): React.CSSProperties {
  const exitEnd = isLast ? scene.end : scene.end + SCENE_TRANSITION_SECONDS;

  if (time < scene.start || time > exitEnd) {
    return {display: 'none'};
  }

  const enterEnd = Math.min(scene.start + SCENE_TRANSITION_SECONDS, scene.end);
  const enterProgress = interpolate(time, [scene.start, enterEnd], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const exitProgress = isLast || time <= scene.end
    ? 1
    : interpolate(time, [scene.end, exitEnd], [1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const opacity = Math.min(enterProgress, exitProgress);
  const translateY = interpolate(enterProgress, [0, 1], [SCENE_ENTER_OFFSET_Y, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const scale = interpolate(enterProgress, [0, 1], [0.985, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});

  return {
    opacity,
    transform: \`translateY(\${translateY}px) scale(\${scale})\`,
    zIndex: time <= scene.end ? 2 : 1,
  };
}
`
}

function normalizeFps(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 30
  }

  return Math.max(1, Math.floor(value))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

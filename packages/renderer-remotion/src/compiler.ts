import type {DeckFormat, MotionTimeline, TimedDeck} from '@video-agent/ir'

import {MotionTimelineSchema, TimedDeckSchema} from '@video-agent/ir'
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
  const size = remotionDeckCanvasSize(timedDeck.deck.format)
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
  await Promise.all([
    writeJson(project.packagePath, createRemotionPackageJson(compositionId)),
    writeJson(project.dataPath, timedDeck),
    writeJson(project.motionPath, motionTimeline),
    writeFile(project.entryPath, createRemotionEntrySource(), 'utf8'),
    writeFile(project.compositionPath, createRemotionCompositionSource(spec), 'utf8'),
  ])

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
import deckData from './deck-data.json';
import motionTimeline from './motion-timeline.json';

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
  const slide = currentSlide(props.deckData, time);
  const style = motionStyle(props.motionTimeline, time);

  return (
    <AbsoluteFill style={{background: '#0f172a', color: 'white', fontFamily: 'Inter, sans-serif'}}>
      <AbsoluteFill style={{padding: 96, justifyContent: 'center', ...style}}>
        <div style={{fontSize: 74, fontWeight: 700, lineHeight: 1.05}}>{slide?.title ?? props.deckData.deck.title}</div>
        <div style={{display: 'grid', gap: 24, marginTop: 64, fontSize: 34, lineHeight: 1.25}}>
          {(slide?.points ?? []).map((point) => <div key={point}>{point}</div>)}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function currentSlide(data: typeof deckData, time: number) {
  const timing = data.timings.find((item, index) => {
    const isLast = index === data.timings.length - 1;
    return time >= item.start && (time < item.end || isLast);
  });

  return data.deck.slides.find((slide) => slide.slideId === timing?.slideId) ?? data.deck.slides[0];
}

function motionStyle(timeline: typeof motionTimeline, time: number): React.CSSProperties {
  const opacityTrack = timeline.tracks.find((track) => track.property === 'opacity' && time >= track.start && time <= track.start + track.duration);
  const translateTrack = timeline.tracks.find((track) => track.property === 'translateY' && time >= track.start && time <= track.start + track.duration);

  return {
    opacity: opacityTrack === undefined ? 1 : interpolate(time, [opacityTrack.start, opacityTrack.start + opacityTrack.duration], [Number(opacityTrack.from), Number(opacityTrack.to)], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}),
    transform: translateTrack === undefined ? undefined : \`translateY(\${interpolate(time, [translateTrack.start, translateTrack.start + translateTrack.duration], [Number(translateTrack.from), Number(translateTrack.to)], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})}px)\`,
  };
}
`
}

function remotionDeckCanvasSize(format: DeckFormat | undefined): {height: number; width: number} {
  if (format === 'landscape_1920x1080') {
    return {height: 1080, width: 1920}
  }

  if (format === 'square_1080x1080') {
    return {height: 1080, width: 1080}
  }

  return {height: 1920, width: 1080}
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

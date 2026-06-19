import type {MotionTimeline} from '@video-agent/ir'
import type {MotionCanvasDeckProject} from '@video-agent/renderer-motion-canvas'
import type {RemotionDeckProject} from '@video-agent/renderer-remotion'

import type {DeckRendererBackend} from './backend.js'
import {toProjectPath} from '../project/paths.js'

export function createDeckRendererBackendArtifact(input: {
  backend: DeckRendererBackend
  backendProject: MotionCanvasDeckProject | RemotionDeckProject
  motionTimeline: MotionTimeline
  projectDir: string
  projectId: string
  sourceSha256: string
}) {
  const files = input.backend === 'remotion'
    ? remotionProjectFiles(input.projectDir, input.backendProject as RemotionDeckProject)
    : motionCanvasProjectFiles(input.projectDir, input.backendProject as MotionCanvasDeckProject)
  const height = 'height' in input.backendProject ? input.backendProject.height : undefined
  const width = 'width' in input.backendProject ? input.backendProject.width : undefined

  return {
    backend: input.backend,
    commandCwd: toProjectPath(input.projectDir, input.backendProject.outputDir),
    files,
    fps: input.backendProject.fps,
    generatedAt: new Date().toISOString(),
    ...(height === undefined ? {} : {height}),
    motionTimelinePath: files.motion,
    motionTrackCount: input.motionTimeline.tracks.length,
    outputDir: toProjectPath(input.projectDir, input.backendProject.outputDir),
    previewCommand: ['bun', 'run', 'preview'],
    projectId: input.projectId,
    renderCommand: ['bun', 'run', 'render'],
    source: 'timed-deck.json' as const,
    sourceSha256: input.sourceSha256,
    version: 1 as const,
    ...(width === undefined ? {} : {width}),
  }
}

function remotionProjectFiles(projectDir: string, project: RemotionDeckProject): Record<string, string> {
  return {
    composition: toProjectPath(projectDir, project.compositionPath),
    data: toProjectPath(projectDir, project.dataPath),
    entry: toProjectPath(projectDir, project.entryPath),
    motion: toProjectPath(projectDir, project.motionPath),
    package: toProjectPath(projectDir, project.packagePath),
  }
}

function motionCanvasProjectFiles(projectDir: string, project: MotionCanvasDeckProject): Record<string, string> {
  return {
    data: toProjectPath(projectDir, project.dataPath),
    motion: toProjectPath(projectDir, project.motionPath),
    package: toProjectPath(projectDir, project.packagePath),
    project: toProjectPath(projectDir, project.projectPath),
    scene: toProjectPath(projectDir, project.scenePath),
  }
}

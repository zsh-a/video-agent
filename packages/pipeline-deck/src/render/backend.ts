import type {RemotionRenderCliResult} from '@video-agent/renderer-remotion'

import {JsonJobStore} from '@video-agent/db'
import {TimedDeckSchema} from '@video-agent/ir'
import {compileDeckMotionPlan, resolveMotionStepsForTemplate} from '@video-agent/renderer-deck'
import {writeMotionCanvasDeckProject} from '@video-agent/renderer-motion-canvas'
import {renderRemotionDeckProject, writeRemotionDeckProject} from '@video-agent/renderer-remotion'
import {resolve} from 'node:path'

import {createProjectWorkspace, refreshArtifactManifest} from '@video-agent/runtime'
import {createDeckRendererBackendArtifact} from './backend-artifacts.js'
import {normalizeDeckRendererFps, sha256File} from './frames/index.js'
import {resolveProjectPath, toProjectPath} from '../project/paths.js'

export type DeckRendererBackend = 'motion-canvas' | 'remotion'

export interface CreateDeckRendererBackendProjectOptions {
  backend: DeckRendererBackend
  compositionId?: string
  fps?: number
  outputDir?: string
  projectId: string
  workspaceDir?: string
}

export interface CreateDeckRendererBackendProjectResult {
  artifactPath: string
  backend: DeckRendererBackend
  commandCwd: string
  files: Record<string, string>
  fps: number
  height?: number
  motionTimelinePath: string
  outputDir: string
  previewCommand: string[]
  projectDir: string
  projectId: string
  renderCommand: string[]
  sourceSha256: string
  status: 'exported'
  width?: number
}

export interface CreateDeckRemotionRenderProjectOptions extends Omit<CreateDeckRendererBackendProjectOptions, 'backend'> {
  command?: string[]
  outputPath?: string
}

export interface CreateDeckRemotionRenderProjectResult {
  artifactPath: string
  backend: 'remotion'
  command: string[]
  commandCwd: string
  exportArtifactPath: string
  outputPath: string
  projectDir: string
  projectId: string
  rendered: RemotionRenderCliResult
  rendererProjectDir: string
  sourceSha256: string
  status: 'rendered'
}

export async function createDeckRendererBackendProject(options: CreateDeckRendererBackendProjectOptions): Promise<CreateDeckRendererBackendProjectResult> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const timedDeck = TimedDeckSchema.parse(await workspace.store.readJson('timed-deck.json'))
  const motionTimeline = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate).timeline
  const outputDir = resolve(options.outputDir ?? resolve(workspace.rendersDir, options.backend))
  const sourceSha256 = await sha256File(workspace.store.resolve('timed-deck.json'))
  const fps = normalizeDeckRendererFps(options.fps ?? motionTimeline.fps)
  const backendProject = options.backend === 'remotion'
    ? await writeRemotionDeckProject({
        compositionId: options.compositionId,
        fps,
        motionTimeline,
        outputDir,
        timedDeck,
      })
    : await writeMotionCanvasDeckProject({
        fps,
        motionTimeline,
        outputDir,
        timedDeck,
      })
  const artifact = createDeckRendererBackendArtifact({
    backend: options.backend,
    backendProject,
    motionTimeline,
    projectDir: workspace.projectDir,
    projectId,
    sourceSha256,
  })
  const artifactPath = await workspace.store.writeJson(`deck-renderer-${options.backend}.json`, artifact)

  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifactPath,
    backend: artifact.backend,
    commandCwd: resolveProjectPath(workspace.projectDir, artifact.commandCwd),
    files: Object.fromEntries(Object.entries(artifact.files).map(([key, value]) => [key, resolveProjectPath(workspace.projectDir, value)])),
    fps: artifact.fps,
    ...(artifact.height === undefined ? {} : {height: artifact.height}),
    motionTimelinePath: resolveProjectPath(workspace.projectDir, artifact.motionTimelinePath),
    outputDir: resolveProjectPath(workspace.projectDir, artifact.outputDir),
    previewCommand: artifact.previewCommand,
    projectDir: workspace.projectDir,
    projectId,
    renderCommand: artifact.renderCommand,
    sourceSha256,
    status: 'exported',
    ...(artifact.width === undefined ? {} : {width: artifact.width}),
  }
}

export async function createDeckRemotionRenderProject(options: CreateDeckRemotionRenderProjectOptions): Promise<CreateDeckRemotionRenderProjectResult> {
  const backendProject = await createDeckRendererBackendProject({
    backend: 'remotion',
    compositionId: options.compositionId,
    fps: options.fps,
    outputDir: options.outputDir,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const rendered = await renderRemotionDeckProject({
    command: options.command,
    outputPath: options.outputPath,
    projectDir: backendProject.outputDir,
  })
  const workspaceDir = options.workspaceDir ?? '.video-agent'
  const projectId = options.projectId
  const jobStore = new JsonJobStore(resolve(workspaceDir, 'projects', projectId, 'job-state.json'))
  const state = await jobStore.read()
  const workspace = await createProjectWorkspace({
    inputPath: state.inputPath,
    projectId,
    workspaceDir,
  })
  const artifact = {
    backend: 'remotion' as const,
    command: rendered.command,
    commandCwd: toProjectPath(workspace.projectDir, backendProject.outputDir),
    completedAt: new Date().toISOString(),
    exportArtifactPath: toProjectPath(workspace.projectDir, backendProject.artifactPath),
    outputPath: toProjectPath(workspace.projectDir, rendered.outputPath),
    rendererProjectDir: toProjectPath(workspace.projectDir, backendProject.outputDir),
    source: 'timed-deck.json',
    sourceSha256: backendProject.sourceSha256,
    stderr: rendered.stderr,
    stdout: rendered.stdout,
    version: 1 as const,
  }
  const artifactPath = await workspace.store.writeJson('deck-renderer-remotion-output.json', artifact)

  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifactPath,
    backend: 'remotion',
    command: rendered.command,
    commandCwd: backendProject.outputDir,
    exportArtifactPath: backendProject.artifactPath,
    outputPath: rendered.outputPath,
    projectDir: workspace.projectDir,
    projectId,
    rendered,
    rendererProjectDir: backendProject.outputDir,
    sourceSha256: backendProject.sourceSha256,
    status: 'rendered',
  }
}

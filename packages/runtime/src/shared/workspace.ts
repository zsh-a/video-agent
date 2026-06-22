import {access, mkdir, writeFile} from 'node:fs/promises'
import {basename, extname, resolve} from 'node:path'

import type {ArtifactStore} from '../artifacts/store.js'

import {FilesystemArtifactStore} from '../artifacts/store.js'
import {writeConfig} from './config.js'
import {DEFAULT_WORKSPACE_DIR} from './defaults.js'

export interface ProjectWorkspace {
  artifactsDir: string
  audioDir: string
  framesDir: string
  inputPath?: string
  projectDir: string
  projectId: string
  rendersDir: string
  store: ArtifactStore
  workspaceDir: string
}

export interface WorkspaceOptions {
  inputPath?: string
  projectId?: string
  workspaceDir?: string
}

export async function createProjectWorkspace(options: WorkspaceOptions = {}): Promise<ProjectWorkspace> {
  const workspaceDir = resolve(options.workspaceDir ?? DEFAULT_WORKSPACE_DIR)
  const projectId = options.projectId ?? createProjectId(options.inputPath)
  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const artifactsDir = resolve(projectDir, 'artifacts')
  const audioDir = resolve(projectDir, 'audio')
  const framesDir = resolve(projectDir, 'frames')
  const rendersDir = resolve(projectDir, 'renders')

  await Promise.all([
    mkdir(artifactsDir, {recursive: true}),
    mkdir(audioDir, {recursive: true}),
    mkdir(framesDir, {recursive: true}),
    mkdir(rendersDir, {recursive: true}),
  ])

  return {
    artifactsDir,
    audioDir,
    framesDir,
    inputPath: options.inputPath === undefined ? undefined : resolve(options.inputPath),
    projectDir,
    projectId,
    rendersDir,
    store: new FilesystemArtifactStore(artifactsDir),
    workspaceDir,
  }
}

export async function initializeWorkspace(workspaceDir = DEFAULT_WORKSPACE_DIR): Promise<string> {
  const resolved = resolve(workspaceDir)

  await mkdir(resolve(resolved, 'projects'), {recursive: true})
  await writeWorkspaceReadme(resolved)
  await writeConfig(resolved, {})

  return resolved
}

async function writeWorkspaceReadme(workspaceDir: string): Promise<void> {
  const readmePath = resolve(workspaceDir, 'README.md')

  if (await fileExists(readmePath)) {
    return
  }

  await writeFile(readmePath, 'This directory stores video-agent project artifacts.\n')
}

export function createProjectId(inputPath?: string, now = new Date()): string {
  const source = inputPath === undefined ? 'project' : basename(inputPath, extname(inputPath))
  const slug = source
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
  const timestamp = now.toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14)

  return `${slug || 'project'}-${timestamp}`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

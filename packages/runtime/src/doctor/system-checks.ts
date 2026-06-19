import {runProcess} from '@video-agent/media'
import {mkdir, unlink} from 'node:fs/promises'
import {resolve} from 'node:path'

import {bunRuntime, bunWrite} from '../shared/bun-runtime.js'
import {readConfig} from '../shared/config.js'
import type {HealthCheck} from './types.js'
import {listProjects} from '../project/projects.js'

export function checkBunRuntime(): HealthCheck {
  const bun = bunRuntime()

  if (bun?.version !== undefined) {
    return {
      details: {version: bun.version},
      message: `Bun ${bun.version}`,
      name: 'bun',
      status: 'pass',
    }
  }

  return {
    message: 'Bun runtime is required.',
    name: 'bun',
    status: 'fail',
  }
}

export async function checkWorkspaceAccess(workspaceDir: string): Promise<HealthCheck> {
  const checkPath = resolve(workspaceDir, '.doctor-write-check')

  try {
    await mkdir(workspaceDir, {recursive: true})
    await bunWrite(checkPath, 'ok\n')
    await unlink(checkPath)

    return {
      message: 'Workspace is writable',
      name: 'workspace',
      status: 'pass',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: 'workspace',
      status: 'fail',
    }
  }
}

export async function checkConfig(workspaceDir: string): Promise<HealthCheck> {
  try {
    const config = await readConfig(workspaceDir)

    return {
      details: {providers: config.providers, version: config.version},
      message: 'Configuration is readable',
      name: 'config',
      status: 'pass',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: 'config',
      status: 'fail',
    }
  }
}

export async function checkProjectListing(workspaceDir: string): Promise<HealthCheck> {
  try {
    const projects = await listProjects(workspaceDir)

    return {
      details: {count: projects.length},
      message: `${projects.length} project${projects.length === 1 ? '' : 's'} found`,
      name: 'projects',
      status: 'pass',
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      name: 'projects',
      status: 'fail',
    }
  }
}

export async function checkBinary(name: string, command: string): Promise<HealthCheck> {
  try {
    const result = await runProcess([command, '-version'])

    if (result.code === 0) {
      return {
        details: {command, version: firstLine(result.stdout || result.stderr)},
        message: `${name} is available`,
        name,
        status: 'pass',
      }
    }

    return {
      details: {command},
      message: firstLine(result.stderr) || `${name} exited with code ${result.code}`,
      name,
      status: 'fail',
    }
  } catch (error) {
    return {
      details: {command},
      message: error instanceof Error ? error.message : String(error),
      name,
      status: 'fail',
    }
  }
}

function firstLine(value: string): string {
  return value.split(/\r?\n/, 1)[0] ?? ''
}

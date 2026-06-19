import {isAbsolute, resolve} from 'node:path'

export function toProjectPath(projectDir: string, path: string): string {
  return path.startsWith(`${projectDir}/`) ? path.slice(projectDir.length + 1) : path
}

export function resolveProjectPath(projectDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(projectDir, path)
}

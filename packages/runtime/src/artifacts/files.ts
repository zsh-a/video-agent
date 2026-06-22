import {readdir} from 'node:fs/promises'
import {join, relative, sep} from 'node:path'

export const JSON_ARTIFACT_KIND = 'json' as const
export const LOG_ARTIFACT_KIND = 'log' as const
export const OTHER_ARTIFACT_KIND = 'other' as const
export const ARTIFACT_KINDS = [JSON_ARTIFACT_KIND, LOG_ARTIFACT_KIND, OTHER_ARTIFACT_KIND] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export async function collectArtifactFiles(rootDir: string, currentDir: string): Promise<Array<{name: string; path: string}>> {
  const entries = await readdir(currentDir, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async (entry): Promise<Array<{name: string; path: string}>> => {
    const path = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      return collectArtifactFiles(rootDir, path)
    }

    if (!entry.isFile()) {
      return []
    }

    return [{
      name: toArtifactName(rootDir, path),
      path,
    }]
  }))

  return nested.flat()
}

export function toArtifactName(rootDir: string, path: string): string {
  return relative(rootDir, path).split(sep).join('/')
}

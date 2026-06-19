import {readdir} from 'node:fs/promises'
import {join, relative, sep} from 'node:path'

export async function listProjectArtifactNames(artifactsDir: string): Promise<string[]> {
  return listArtifactNames(artifactsDir, artifactsDir)
}

async function listArtifactNames(rootDir: string, currentDir: string): Promise<string[]> {
  const entries = await readdir(currentDir, {withFileTypes: true})
  const nested = await Promise.all(entries.map(async (entry): Promise<string[]> => {
    const path = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      return listArtifactNames(rootDir, path)
    }

    if (!entry.isFile()) {
      return []
    }

    return [relative(rootDir, path).split(sep).join('/')]
  }))

  return nested.flat().sort((a, b) => a.localeCompare(b))
}

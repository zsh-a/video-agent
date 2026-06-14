import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

export interface ArtifactStore {
  readJson<T>(path: string): Promise<T>
  resolve(path: string): string
  writeJson(path: string, value: unknown): Promise<string>
}

export class FilesystemArtifactStore implements ArtifactStore {
  constructor(private readonly rootDir: string) {}

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(this.resolve(path), 'utf8')) as T
  }

  resolve(path: string): string {
    return join(this.rootDir, path)
  }

  async writeJson(path: string, value: unknown): Promise<string> {
    const resolved = this.resolve(path)
    await mkdir(dirname(resolved), {recursive: true})
    await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`)
    return resolved
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return Bun.file(path).json<T>()
}

export async function readJsonLines<T>(path: string): Promise<T[]> {
  return (await readText(path))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

export async function readText(path: string): Promise<string> {
  return Bun.file(path).text()
}

export async function writeText(path: string, content: string): Promise<void> {
  await Bun.write(path, content)
}

export async function writeBytes(path: string, content: Uint8Array): Promise<void> {
  await Bun.write(path, content)
}

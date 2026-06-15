import {bunFile} from './bun-runtime.js'

export async function assertFileExists(path: string, message = `ENOENT: no such file or directory, access '${path}'`): Promise<void> {
  if (await bunFile(path).exists()) {
    return
  }

  throw Object.assign(new Error(message), {code: 'ENOENT'})
}

export async function readJsonLines<T>(path: string): Promise<T[]> {
  const text = await readOptionalText(path)

  if (text === undefined) {
    return []
  }

  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

export async function readOptionalJson<T>(path: string): Promise<T | undefined> {
  const text = await readOptionalText(path)

  return text === undefined ? undefined : JSON.parse(text) as T
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await bunFile(path).text()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

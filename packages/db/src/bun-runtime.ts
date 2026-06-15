export interface DbBunFile {
  exists(): Promise<boolean>
  json<T>(): Promise<T>
}

export interface DbBun {
  file(path: string): DbBunFile
  write(path: string, data: string): Promise<number>
}

export function bunFile(path: string): DbBunFile {
  return bunRuntime().file(path)
}

export async function bunWrite(path: string, data: string): Promise<void> {
  await bunRuntime().write(path, data)
}

function bunRuntime(): DbBun {
  const bun = (globalThis as typeof globalThis & {Bun?: DbBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent database requires Bun.')
  }

  return bun
}

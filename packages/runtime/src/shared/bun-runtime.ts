export interface RuntimeBunFile {
  bytes(): Promise<Uint8Array>
  exists(): Promise<boolean>
  json<T>(): Promise<T>
  text(): Promise<string>
}

export interface RuntimeBun {
  env: Record<string, string | undefined>
  file(path: string): RuntimeBunFile
  version?: string
  write(path: string, data: Blob | RuntimeBunFile | string | Uint8Array): Promise<number>
}

export async function bunCopyFile(sourcePath: string, targetPath: string): Promise<void> {
  await bunRuntime().write(targetPath, bunFile(sourcePath))
}

export function bunEnv(): Record<string, string | undefined> {
  return bunRuntime().env
}

export function bunFile(path: string): RuntimeBunFile {
  return bunRuntime().file(path)
}

export function bunRuntime(): RuntimeBun {
  const bun = (globalThis as typeof globalThis & {Bun?: RuntimeBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent runtime requires Bun.')
  }

  return bun
}

export async function bunWrite(path: string, data: Blob | RuntimeBunFile | string | Uint8Array): Promise<void> {
  await bunRuntime().write(path, data)
}

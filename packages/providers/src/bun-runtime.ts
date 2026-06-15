export interface ProviderBunFile {
  bytes(): Promise<Uint8Array>
}

export interface ProviderBun {
  env: Record<string, string | undefined>
  file(path: string): ProviderBunFile
}

export function bunEnv(): Record<string, string | undefined> {
  return bunRuntime().env
}

export function bunFile(path: string): ProviderBunFile {
  return bunRuntime().file(path)
}

function bunRuntime(): ProviderBun {
  const bun = (globalThis as typeof globalThis & {Bun?: ProviderBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent providers require Bun.')
  }

  return bun
}

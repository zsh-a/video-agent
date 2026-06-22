export interface ProviderBun {
  env: Record<string, string | undefined>
}

export function bunEnv(): Record<string, string | undefined> {
  return bunRuntime().env
}

function bunRuntime(): ProviderBun {
  const bun = (globalThis as typeof globalThis & {Bun?: ProviderBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent providers require Bun.')
  }

  return bun
}

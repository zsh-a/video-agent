export interface RuntimeBun {
  env: Record<string, string | undefined>
  version?: string
}

export function bunEnv(): Record<string, string | undefined> {
  return bunRuntime().env
}

export function bunRuntime(): RuntimeBun {
  const bun = (globalThis as typeof globalThis & {Bun?: RuntimeBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent runtime requires Bun.')
  }

  return bun
}

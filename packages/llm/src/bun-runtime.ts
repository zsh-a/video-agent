export interface LLMBun {
  env: Record<string, string | undefined>
}

export function bunEnv(): Record<string, string | undefined> {
  const bun = (globalThis as typeof globalThis & {Bun?: LLMBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent LLM requires Bun.')
  }

  return bun.env
}

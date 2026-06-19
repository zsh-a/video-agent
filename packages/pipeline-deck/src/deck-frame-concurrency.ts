export async function runConcurrentMap<Input, Output>(items: Input[], concurrency: number, worker: (item: Input) => Promise<Output>): Promise<Output[]> {
  const results = new Array<Output>(items.length)
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex

      nextIndex += 1
      const item = items[index]

      if (item === undefined) {
        continue
      }

      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(item)
    }
  }

  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, () => runWorker()))

  return results
}

export async function retryDeckShardCapture<T>(input: {
  delayMs: number
  retries: number
  run: () => Promise<T>
}): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt <= input.retries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await input.run()
    } catch (error) {
      lastError = error

      if (attempt >= input.retries) {
        break
      }

      if (input.delayMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(input.delayMs)
      }
    }
  }

  throw lastError
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms)
  })
}

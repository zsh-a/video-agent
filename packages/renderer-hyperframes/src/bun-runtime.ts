export interface HyperframesBunFile {
  text(): Promise<string>
}

export interface HyperframesBun {
  file(path: string): HyperframesBunFile
  write(path: string, data: string): Promise<number>
}

export function bunFile(path: string): HyperframesBunFile {
  return bunRuntime().file(path)
}

export async function bunWrite(path: string, data: string): Promise<void> {
  await bunRuntime().write(path, data)
}

function bunRuntime(): HyperframesBun {
  const bun = (globalThis as typeof globalThis & {Bun?: HyperframesBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent HyperFrames renderer requires Bun.')
  }

  return bun
}

export interface HtmlRendererBunFile {
  text(): Promise<string>
}

export interface HtmlRendererBun {
  file(path: string): HtmlRendererBunFile
  write(path: string, data: string): Promise<number>
}

export async function bunWrite(path: string, data: string): Promise<void> {
  await bunRuntime().write(path, data)
}

function bunRuntime(): HtmlRendererBun {
  const bun = (globalThis as typeof globalThis & {Bun?: HtmlRendererBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent HTML renderer requires Bun.')
  }

  return bun
}

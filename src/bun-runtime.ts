interface CliBunFile {
  exists(): Promise<boolean>
}

interface CliBunServer {
  hostname: string
  port: number
  url: URL
}

interface CliBun {
  file(path: string): CliBunFile
  serve(options: {fetch(request: Request): Promise<Response> | Response; hostname: string; port: number}): CliBunServer
}

export function bunFile(path: string): CliBunFile {
  return bunRuntime().file(path)
}

export async function assertFileExists(path: string): Promise<void> {
  if (await bunFile(path).exists()) {
    return
  }

  throw Object.assign(new Error(`ENOENT: no such file or directory, access '${path}'`), {code: 'ENOENT'})
}

export function bunServe(options: Parameters<CliBun['serve']>[0]): CliBunServer {
  return bunRuntime().serve(options)
}

function bunRuntime(): CliBun {
  const bun = (globalThis as typeof globalThis & {Bun?: CliBun}).Bun

  if (bun === undefined) {
    throw new Error('video-agent CLI requires Bun.')
  }

  return bun
}

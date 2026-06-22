interface CliBunServer {
  hostname: string
  port: number
  url: URL
}

interface CliBun {
  serve(options: {fetch(request: Request): Promise<Response> | Response; hostname: string; port: number}): CliBunServer
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

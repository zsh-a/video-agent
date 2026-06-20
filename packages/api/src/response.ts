import {readFile} from 'node:fs/promises'
import {extname, relative, resolve, sep} from 'node:path'

export interface JsonResponseInit extends ResponseInit {
  headers?: Record<string, string>
}

export function jsonResponse(value: unknown, init?: JsonResponseInit): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init?.headers,
    },
  })
}

export function htmlResponse(value: string): Response {
  return new Response(value, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
    },
  })
}

export async function staticFileResponse(rootDir: string, requestPath: string, request?: Request): Promise<Response> {
  const filePath = resolve(rootDir, requestPath)
  const relativePath = relative(rootDir, filePath)

  if (relativePath === '' || relativePath.startsWith('..') || relativePath.split(sep).includes('..')) {
    return jsonResponse({error: {message: 'Static file path must stay inside the asset directory.'}}, {status: 400})
  }

  return fileResponse(filePath, request)
}

export async function projectFileResponse(projectId: string, projectPath: null | string, workspaceDir: string, request?: Request): Promise<Response> {
  if (projectPath === null || projectPath.trim() === '') {
    return jsonResponse({error: {message: 'Missing project file path.'}}, {status: 400})
  }

  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const filePath = resolve(projectDir, projectPath)
  const relativePath = relative(projectDir, filePath)

  if (relativePath === '' || relativePath.startsWith('..') || relativePath.split(sep).includes('..')) {
    return jsonResponse({error: {message: 'Project file path must stay inside the project directory.'}}, {status: 400})
  }

  return fileResponse(filePath, request)
}

async function fileResponse(filePath: string, request?: Request): Promise<Response> {
  const content = await readFile(filePath)
  const range = parseRangeHeader(request?.headers.get('range'), content.length)
  const contentType = contentTypeForPath(filePath)

  if (range === 'invalid') {
    return new Response(undefined, {
      headers: {
        'accept-ranges': 'bytes',
        'content-range': `bytes */${content.length}`,
      },
      status: 416,
    })
  }

  if (range !== undefined) {
    const body = content.subarray(range.start, range.end + 1)

    return new Response(new Uint8Array(body), {
      headers: {
        'accept-ranges': 'bytes',
        'content-length': String(body.length),
        'content-range': `bytes ${range.start}-${range.end}/${content.length}`,
        'content-type': contentType,
      },
      status: 206,
    })
  }

  return new Response(new Uint8Array(content), {
    headers: {
      'accept-ranges': 'bytes',
      'content-length': String(content.length),
      'content-type': contentType,
    },
  })
}

export function methodNotAllowed(): Response {
  return jsonResponse({error: {message: 'Method not allowed'}}, {status: 405})
}

function parseRangeHeader(value: null | string | undefined, size: number): 'invalid' | {end: number; start: number} | undefined {
  if (value === undefined || value === null || value.trim() === '') {
    return undefined
  }

  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim())

  if (match === null) {
    return 'invalid'
  }

  const [, startText, endText] = match

  if (startText === '' && endText === '') {
    return 'invalid'
  }

  if (startText === '') {
    const suffixLength = Number(endText)

    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return 'invalid'
    }

    return {
      end: size - 1,
      start: Math.max(0, size - suffixLength),
    }
  }

  const start = Number(startText)
  const end = endText === '' ? size - 1 : Number(endText)

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return 'invalid'
  }

  return {
    end: Math.min(end, size - 1),
    start,
  }
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.css':
      return 'text/css; charset=utf-8'
    case '.html':
      return 'text/html; charset=utf-8'
    case '.ico':
      return 'image/x-icon'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.mp4':
      return 'video/mp4'
    case '.png':
      return 'image/png'
    case '.srt':
      return 'text/plain; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

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

export async function projectFileResponse(projectId: string, projectPath: null | string, workspaceDir: string): Promise<Response> {
  if (projectPath === null || projectPath.trim() === '') {
    return jsonResponse({error: {message: 'Missing project file path.'}}, {status: 400})
  }

  const projectDir = resolve(workspaceDir, 'projects', projectId)
  const filePath = resolve(projectDir, projectPath)
  const relativePath = relative(projectDir, filePath)

  if (relativePath === '' || relativePath.startsWith('..') || relativePath.split(sep).includes('..')) {
    return jsonResponse({error: {message: 'Project file path must stay inside the project directory.'}}, {status: 400})
  }

  const content = await readFile(filePath)

  return new Response(new Uint8Array(content), {
    headers: {
      'content-type': contentTypeForPath(filePath),
    },
  })
}

export function methodNotAllowed(): Response {
  return jsonResponse({error: {message: 'Method not allowed'}}, {status: 405})
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.mp4':
      return 'video/mp4'
    case '.png':
      return 'image/png'
    case '.srt':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

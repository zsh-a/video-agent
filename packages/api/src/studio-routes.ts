import {join, resolve} from 'node:path'

import {htmlResponse, methodNotAllowed, staticFileResponse} from './response.js'

interface StudioRouteContext {
  request: Request
  segments: string[]
}

const studioDistDir = resolve(process.cwd(), 'packages/studio/dist')

export async function routeStudioRequest({request, segments}: StudioRouteContext): Promise<Response> {
  if (request.method !== 'GET') {
    return methodNotAllowed()
  }

  if (segments.length === 1) {
    return staticFileResponse(studioDistDir, 'index.html', request)
  }

  if (segments[1] === 'assets' && segments[2] !== undefined) {
    return staticFileResponse(studioDistDir, join(...segments.slice(1)), request)
  }

  return htmlResponse('<!doctype html><title>video-agent studio</title><p>Studio asset not found.</p>')
}

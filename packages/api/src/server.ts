import {errorResponse} from './errors.js'
import {routeRequest} from './routes.js'

import {DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'
export interface ApiHandlerOptions {
  workspaceDir?: string
}

export function createApiFetchHandler(options: ApiHandlerOptions = {}): (request: Request) => Promise<Response> {
  const workspaceDir = options.workspaceDir ?? DEFAULT_WORKSPACE_DIR

  return async (request) => {
    try {
      return await routeRequest(request, workspaceDir)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

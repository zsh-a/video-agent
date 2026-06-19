import {errorResponse} from './errors.js'
import {routeRequest} from './routes.js'

export type {ProjectEventKind, ProviderCallRole, ProviderCallStatus} from '@video-agent/runtime'

export interface ApiHandlerOptions {
  workspaceDir?: string
}

export function createApiFetchHandler(options: ApiHandlerOptions = {}): (request: Request) => Promise<Response> {
  const workspaceDir = options.workspaceDir ?? '.video-agent'

  return async (request) => {
    try {
      return await routeRequest(request, workspaceDir)
    } catch (error) {
      return errorResponse(error)
    }
  }
}

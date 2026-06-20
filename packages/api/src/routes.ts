import {routeProjectRequest} from './project-routes.js'
import {routeRootRequest} from './root-routes.js'
import {routeStudioRequest} from './studio-routes.js'

export async function routeRequest(request: Request, workspaceDir: string): Promise<Response> {
  const url = new URL(request.url)
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))

  if (segments[0] === 'projects' && segments[1] !== undefined) {
    return routeProjectRequest(request, segments.slice(1), url, workspaceDir)
  }

  if (segments[0] === 'studio') {
    return routeStudioRequest({request, segments})
  }

  return routeRootRequest(request, segments, url, workspaceDir)
}

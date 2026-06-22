import {ExportQualityError, PipelineCheckpointError} from '@video-agent/runtime'
import {ZodError} from 'zod'

import {ApiRequestError} from './request.js'
import {jsonResponse} from './response.js'

export function errorResponse(error: unknown): Response {
  if (error instanceof PipelineCheckpointError) {
    return jsonResponse(
      {
        error: {
          changedArtifacts: error.changedArtifacts,
          code: 'checkpoint_invalid',
          fromStage: error.fromStage,
          message: error.message,
          missingArtifacts: error.missingArtifacts,
          name: error.name,
          schemaInvalidArtifacts: error.schemaInvalidArtifacts,
          untrackedArtifacts: error.untrackedArtifacts,
        },
      },
      {status: 409},
    )
  }

  if (error instanceof ZodError) {
    return jsonResponse(
      {
        error: {
          code: 'validation_error',
          issues: error.issues.map((issue) => ({
            code: issue.code,
            message: issue.message,
            path: issue.path.map(String),
          })),
          message: 'Validation failed.',
        },
      },
      {status: 422},
    )
  }

  if (error instanceof ExportQualityError) {
    return jsonResponse(
      {
        error: {
          code: 'export_quality_failed',
          message: error.message,
          name: error.name,
          projectId: error.projectId,
          quality: error.quality,
        },
      },
      {status: 409},
    )
  }

  if (error instanceof ApiRequestError) {
    return jsonResponse(
      {
        error: {
          code: 'bad_request',
          message: error.message,
          name: error.name,
        },
      },
      {status: 400},
    )
  }

  return jsonResponse(
    {
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    },
    {status: isNotFoundError(error) ? 404 : 500},
  )
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

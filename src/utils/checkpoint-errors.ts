import {type PipelineCheckpointError} from '@video-agent/runtime'

export function createCheckpointErrorPayload(error: PipelineCheckpointError): {
  error: {
    changedArtifacts: string[]
    code: 'checkpoint_invalid'
    fromStage: string
    message: string
    missingArtifacts: string[]
    name: string
    schemaInvalidArtifacts: string[]
    untrackedArtifacts: string[]
  }
} {
  return {
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
  }
}

export function formatCheckpointFailure(error: PipelineCheckpointError): string {
  return [
    `Checkpoint blocked: cannot resume from ${error.fromStage}.`,
    `Missing artifacts: ${formatArtifactList(error.missingArtifacts)}`,
    `Changed artifacts: ${formatArtifactList(error.changedArtifacts)}`,
    `Schema invalid artifacts: ${formatArtifactList(error.schemaInvalidArtifacts)}`,
    `Untracked required artifacts: ${formatArtifactList(error.untrackedArtifacts)}`,
    `Message: ${error.message}`,
  ].join('\n')
}

function formatArtifactList(artifacts: string[]): string {
  return artifacts.length === 0 ? 'none' : artifacts.join(', ')
}

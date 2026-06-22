import type {RecoverFilmWorkspaceJobResult} from '@video-agent/pipeline-film'

export function formatWorkerResult(result: RecoverFilmWorkspaceJobResult): string {
  const diagnostics = [
    result.error,
    formatWorkerArtifactList('missing', result.missingArtifacts),
    formatWorkerArtifactList('changed', result.changedArtifacts),
    formatWorkerArtifactList('schema invalid', result.schemaInvalidArtifacts),
    formatWorkerArtifactList('untracked', result.untrackedArtifacts),
    result.validationIssues?.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; '),
  ].filter((item): item is string => item !== undefined).join('; ')

  return `${result.projectId}\t${result.status}${result.fromStage === undefined ? '' : `\t${result.fromStage}`}${result.skipReason === undefined ? '' : `\t${result.skipReason}`}${diagnostics === '' ? '' : `\t${diagnostics}`}`
}

function formatWorkerArtifactList(label: string, artifacts?: string[]): string | undefined {
  return artifacts === undefined || artifacts.length === 0 ? undefined : `${label}: ${artifacts.join(', ')}`
}

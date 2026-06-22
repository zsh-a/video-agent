import type {PipelineEvent} from '@video-agent/core'
import type {ProjectWorkspace} from '../shared/workspace.js'

import {appendFile, mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {PIPELINE_EVENTS_LOG_ARTIFACT_NAME} from '../artifacts/log-artifact-names.js'

export async function appendProjectEvent(workspace: ProjectWorkspace, event: PipelineEvent): Promise<void> {
  const path = workspace.store.resolve(PIPELINE_EVENTS_LOG_ARTIFACT_NAME)

  await mkdir(dirname(path), {recursive: true})
  await appendFile(path, `${JSON.stringify(event)}\n`)
}

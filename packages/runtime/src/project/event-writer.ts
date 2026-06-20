import type {PipelineEvent} from '@video-agent/core'
import type {ProjectWorkspace} from '../shared/workspace.js'

import {appendFile, mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

export async function appendProjectEvent(workspace: ProjectWorkspace, event: PipelineEvent): Promise<void> {
  const path = workspace.store.resolve('pipeline-events.jsonl')

  await mkdir(dirname(path), {recursive: true})
  await appendFile(path, `${JSON.stringify(event)}\n`)
}

export function createProjectEvent(input: Omit<PipelineEvent, 'projectId' | 'time'> & {
  projectId: string
  time?: string
}): PipelineEvent {
  return {
    ...input,
    time: input.time ?? new Date().toISOString(),
  }
}

import type {RunTuiActionOptions, TuiActionResult} from './types.js'

import {createTuiCommandSuggestions} from '../format/command.js'
import {isTuiCommandAction} from '../model.js'
import {readTuiSnapshot} from '../snapshot.js'

export async function runTuiCommandAction(options: RunTuiActionOptions): Promise<TuiActionResult | undefined> {
  if (!isTuiCommandAction(options.action)) {
    return undefined
  }

  const commands = createTuiCommandSuggestions(await readTuiSnapshot({
    artifactLimit: options.artifactLimit,
    eventLimit: 0,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  }), {commandPrefix: options.commandPrefix})

  return options.action === 'commands'
    ? {commands, type: 'commands'}
    : {commands, type: 'select'}
}

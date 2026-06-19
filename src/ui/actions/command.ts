import type {RunTuiActionOptions, TuiActionResult} from './types.js'

import {createTuiCommandSuggestions} from '../format/command.js'
import {readTuiSnapshot} from '../snapshot.js'

export async function runTuiCommandAction(options: RunTuiActionOptions): Promise<TuiActionResult | undefined> {
  if (options.action !== 'commands' && options.action !== 'select') {
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

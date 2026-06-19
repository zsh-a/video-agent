import type {RunTuiActionOptions, TuiActionResult} from './tui-action-types.js'

import {createTuiCommandSuggestions} from './tui-command-format.js'
import {readTuiSnapshot} from './tui-snapshot.js'

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

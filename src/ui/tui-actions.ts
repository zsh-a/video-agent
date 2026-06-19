import type {RunTuiActionOptions, TuiActionResult} from './tui-action-types.js'

import {runTuiCommandAction} from './tui-command-actions.js'
import {runTuiInspectAction} from './tui-inspect-actions.js'
import {runTuiOperateAction} from './tui-operate-actions.js'

export type {
  ReadTuiSnapshotOptions,
  RunTuiActionOptions,
  TuiActionResult,
  TuiCheckpointErrorActionResult,
  TuiExportQualityErrorActionResult,
  TuiQualityReport,
} from './tui-action-types.js'

export {readTuiSnapshot} from './tui-snapshot.js'

export async function runTuiAction(options: RunTuiActionOptions): Promise<TuiActionResult> {
  if (options.action === 'dashboard') {
    return {type: 'dashboard'}
  }

  const commandResult = await runTuiCommandAction(options)

  if (commandResult !== undefined) {
    return commandResult
  }

  const inspectResult = await runTuiInspectAction(options)

  if (inspectResult !== undefined) {
    return inspectResult
  }

  return runTuiOperateAction(options)
}

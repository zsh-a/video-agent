import type {RunTuiActionOptions, TuiActionResult} from './types.js'

import {runTuiCommandAction} from './command.js'
import {runTuiInspectAction} from './inspect.js'
import {runTuiOperateAction} from './operate.js'

export type {
  ReadTuiSnapshotOptions,
  RunTuiActionOptions,
  TuiActionResult,
  TuiCheckpointErrorActionResult,
  TuiExportQualityErrorActionResult,
  TuiQualityReport,
} from './types.js'

export {readTuiSnapshot} from '../snapshot.js'

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

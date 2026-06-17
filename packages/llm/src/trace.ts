import type {LLMTraceRecord, LLMTraceRecorder} from './types.js'

import {appendFile, mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'

export function createJsonlLLMTraceRecorder(path: string): LLMTraceRecorder {
  return {
    async record(trace) {
      await mkdir(dirname(path), {recursive: true})
      await appendFile(path, `${JSON.stringify(trace)}\n`)
    },
  }
}

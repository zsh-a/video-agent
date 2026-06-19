import type {BunReadableStream} from './bun-runtime.js'

export interface FfmpegProgressRecord {
  [key: string]: string
}

export type FfmpegProgressHandler = (record: FfmpegProgressRecord) => Promise<void> | void

export function parseFfmpegProgressOutput(output: string): FfmpegProgressRecord[] {
  const records: FfmpegProgressRecord[] = []
  let current: FfmpegProgressRecord = {}

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line === '') {
      continue
    }

    const separator = line.indexOf('=')

    if (separator < 1) {
      continue
    }

    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)

    current[key] = value

    if (key === 'progress') {
      records.push({...current})

      if (value === 'end') {
        current = {}
      }
    }
  }

  return records
}

export async function readFfmpegProgressStream(stream: BunReadableStream, onProgress: FfmpegProgressHandler | undefined): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let current: FfmpegProgressRecord = {}
  let progressFlush = Promise.resolve()

  /* eslint-disable no-await-in-loop */
  while (true) {
    const {done, value} = await reader.read()

    if (done === true) {
      break
    }

    if (value === undefined) {
      continue
    }

    buffer += decoder.decode(value, {stream: true})

    const parsed = parseFfmpegProgressBuffer(buffer, current)

    buffer = parsed.buffer
    current = parsed.current

    progressFlush = progressFlush.then(() => emitFfmpegProgressRecords(parsed.records, onProgress))
  }
  /* eslint-enable no-await-in-loop */

  buffer += decoder.decode()

  if (buffer.trim() !== '') {
    const parsed = parseFfmpegProgressBuffer(`${buffer}\n`, current)

    progressFlush = progressFlush.then(() => emitFfmpegProgressRecords(parsed.records, onProgress))
  }

  await progressFlush
}

function parseFfmpegProgressBuffer(buffer: string, current: FfmpegProgressRecord): {buffer: string; current: FfmpegProgressRecord; records: FfmpegProgressRecord[]} {
  const records: FfmpegProgressRecord[] = []
  let rest = buffer
  let nextCurrent = current
  let index = rest.indexOf('\n')

  while (index >= 0) {
    const line = rest.slice(0, index).trim()

    rest = rest.slice(index + 1)

    if (line !== '') {
      const separator = line.indexOf('=')

      if (separator > 0) {
        const key = line.slice(0, separator)
        const value = line.slice(separator + 1)

        nextCurrent[key] = value

        if (key === 'progress') {
          records.push({...nextCurrent})

          if (value === 'end') {
            nextCurrent = {}
          }
        }
      }
    }

    index = rest.indexOf('\n')
  }

  return {
    buffer: rest,
    current: nextCurrent,
    records,
  }
}

async function emitFfmpegProgressRecords(records: FfmpegProgressRecord[], onProgress: FfmpegProgressHandler | undefined): Promise<void> {
  if (onProgress === undefined || records.length === 0) {
    return
  }

  await Promise.all(records.map((record) => onProgress(record)))
}

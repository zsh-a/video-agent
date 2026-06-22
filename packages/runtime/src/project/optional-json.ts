import {JsonFileParseError, readOptionalJson} from '../shared/file-io.js'

export async function readOptionalProjectJson(path: string): Promise<unknown | undefined> {
  try {
    return await readOptionalJson(path)
  } catch (error) {
    if (error instanceof JsonFileParseError) {
      return undefined
    }

    throw error
  }
}

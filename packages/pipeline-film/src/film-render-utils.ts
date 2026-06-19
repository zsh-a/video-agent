import {unlink} from 'node:fs/promises'

export async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }

    throw error
  }
}

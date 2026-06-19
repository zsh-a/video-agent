import type {Document} from '@video-agent/ir'

import {extname} from 'node:path'

export function inferDocumentSourceType(inputPath: string): Document['source']['sourceType'] {
  const extension = extname(inputPath).toLowerCase()

  if (extension === '.md' || extension === '.markdown') {
    return 'markdown'
  }

  if (extension === '.html' || extension === '.htm') {
    return 'html'
  }

  if (extension === '.pdf') {
    return 'pdf'
  }

  return 'text'
}

export function isAudioInputPath(inputPath: string): boolean {
  return ['.aac', '.aiff', '.flac', '.m4a', '.mp3', '.ogg', '.opus', '.wav', '.weba'].includes(extname(inputPath).toLowerCase())
}

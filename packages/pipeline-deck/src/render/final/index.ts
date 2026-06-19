import {createDeckHtmlFinalRenderProject} from './html.js'
import {createDeckRemotionFinalRenderProject} from './remotion.js'
import type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './types.js'

export type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './types.js'

export async function createDeckFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  if ((options.renderer ?? 'remotion') === 'html') {
    return createDeckHtmlFinalRenderProject(options)
  }

  return createDeckRemotionFinalRenderProject(options)
}

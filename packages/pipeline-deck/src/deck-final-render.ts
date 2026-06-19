import {createDeckHtmlFinalRenderProject} from './deck-final-render-html.js'
import {createDeckRemotionFinalRenderProject} from './deck-final-render-remotion.js'
import type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './deck-final-render-types.js'

export type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './deck-final-render-types.js'

export async function createDeckFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  if ((options.renderer ?? 'remotion') === 'html') {
    return createDeckHtmlFinalRenderProject(options)
  }

  return createDeckRemotionFinalRenderProject(options)
}

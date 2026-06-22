import {createDeckHtmlFinalRenderProject} from './html.js'
import {createDeckRemotionFinalRenderProject} from './remotion.js'
import type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './types.js'
import {DEFAULT_DECK_FINAL_RENDERER} from '../renderers.js'

export type {CreateDeckFinalRenderProjectOptions, CreateDeckFinalRenderProjectResult} from './types.js'

export async function createDeckFinalRenderProject(options: CreateDeckFinalRenderProjectOptions): Promise<CreateDeckFinalRenderProjectResult> {
  if ((options.renderer ?? DEFAULT_DECK_FINAL_RENDERER) === 'html') {
    return createDeckHtmlFinalRenderProject(options)
  }

  return createDeckRemotionFinalRenderProject(options)
}

import type {Deck} from '@video-agent/ir'

import {componentCss} from '../components/styles.js'
import {templateCss} from '../templates/styles.js'
import {themeTokensCss} from '../themes/tokens.js'
import {baseCss, rootTokensCss} from './base.js'
import {captureCss} from './capture.js'
import {fontFacesCss} from './fonts.js'
import {tailwindDirectives, type TailwindDirectivesOptions} from './tailwind-directives.js'

export type CreateDeckCssOptions = TailwindDirectivesOptions

export function createDeckCss(deck: Deck, options: CreateDeckCssOptions): string {
  return [
    tailwindDirectives(options),
    fontFacesCss(),
    rootTokensCss(deck),
    themeTokensCss(),
    baseCss(),
    componentCss(),
    templateCss(),
    captureCss(),
  ].join('\n\n')
}

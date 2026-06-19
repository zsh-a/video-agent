import type {Deck, SlideTiming} from '@video-agent/ir'

import {renderToStaticMarkup} from 'react-dom/server'

import {DeckStageView} from './view.js'

export interface RenderDeckStageOptions {
  captureSlideId?: string
  timings: SlideTiming[]
}

export function renderDeckStage(deck: Deck, options: RenderDeckStageOptions): string {
  return renderToStaticMarkup(<DeckStageView deck={deck} timings={options.timings} captureSlideId={options.captureSlideId} />)
}

import type {Deck, SlideTiming} from '@video-agent/ir'

import {renderToStaticMarkup} from 'react-dom/server'

import {CodeHighlightProvider, type CodeHighlightMap} from '../components/code-highlight-context.js'
import {DeckStageView} from './view.js'

export interface RenderDeckStageOptions {
  captureSlideId?: string
  codeHighlights?: CodeHighlightMap
  timings: SlideTiming[]
}

export function renderDeckStage(deck: Deck, options: RenderDeckStageOptions): string {
  return renderToStaticMarkup(
    <CodeHighlightProvider highlights={options.codeHighlights}>
      <DeckStageView deck={deck} timings={options.timings} captureSlideId={options.captureSlideId} />
    </CodeHighlightProvider>,
  )
}

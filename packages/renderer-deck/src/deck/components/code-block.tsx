import type {DeckCodeBlock} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card, Stack} from '../layout/primitives.js'
import {useCodeHighlight} from './code-highlight-context.js'

export function CodeBlock({code}: {code: DeckCodeBlock}): ReactNode {
  const highlightedHtml = useCodeHighlight(code)

  return (
    <Card className="code-block grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface shadow-deck-card" data-language={code.language}>
      <div className="code-block__header flex items-center justify-between border-b border-deck-line-soft p-[18px_24px] text-deck-caption font-bold text-deck-muted">
        <span className="text-deck-accent">Code</span>
        <span>{code.language}</span>
      </div>
      <Stack className="code-block__body grid gap-0 p-[12px]">
        {highlightedHtml === undefined
          ? <pre className="code-block__fallback"><code>{code.text}</code></pre>
          : <div className="code-block__highlight" dangerouslySetInnerHTML={{__html: highlightedHtml}} />}
      </Stack>
    </Card>
  )
}

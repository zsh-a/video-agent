import type {DeckCodeBlock} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card, Stack} from '../layout/primitives.js'

export function CodeBlock({code}: {code: DeckCodeBlock}): ReactNode {
  const lines = code.text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return (
    <Card className="code-block grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface shadow-deck-card" data-language={code.language}>
      <div className="code-block__header flex items-center justify-between border-b border-deck-line-soft p-[18px_24px] text-deck-caption font-bold text-deck-muted">
        <span className="text-deck-accent">Template</span>
        <span>{code.language}</span>
      </div>
      <Stack className="code-block__body grid gap-0 p-[12px]">
        {(lines.length === 0 ? [code.text] : lines).slice(0, 12).map((line, index) => (
          <div className="code-line grid min-h-[52px] grid-cols-[44px_minmax(0,1fr)] items-center gap-[14px] border border-transparent border-b-deck-line-soft p-[11px_14px]" key={`${line}-${index}`}>
            <span className="code-line__index text-[calc(var(--font-caption)*0.9)] font-bold text-deck-accent-2">{String(index + 1).padStart(2, '0')}</span>
            <code className="whitespace-normal break-words font-sans text-[calc(var(--font-body)*0.78)] leading-[1.28] text-deck-fg">{normalizeCodeLine(line)}</code>
          </div>
        ))}
      </Stack>
    </Card>
  )
}

function normalizeCodeLine(value: string): string {
  return value.replace(/^#+\s*/, '')
}

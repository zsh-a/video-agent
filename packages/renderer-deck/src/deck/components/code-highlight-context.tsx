import type {DeckCodeBlock} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {createContext, useContext} from 'react'

export type CodeHighlightMap = ReadonlyMap<string, string>

const CodeHighlightContext = createContext<CodeHighlightMap | undefined>(undefined)

export function CodeHighlightProvider({
  children,
  highlights,
}: {
  children: ReactNode
  highlights?: CodeHighlightMap
}): ReactNode {
  return (
    <CodeHighlightContext.Provider value={highlights}>
      {children}
    </CodeHighlightContext.Provider>
  )
}

export function useCodeHighlight(code: DeckCodeBlock): string | undefined {
  return useContext(CodeHighlightContext)?.get(codeHighlightKey(code))
}

export function codeHighlightKey(code: DeckCodeBlock): string {
  return `${normalizeCodeLanguage(code.language)}\u0000${code.text}`
}

export function normalizeCodeLanguage(language: string): string {
  return language.trim().toLowerCase() || 'text'
}

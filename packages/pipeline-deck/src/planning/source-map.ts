import type {DeckSourceMap, DeckSourceSection, Document} from '@video-agent/ir'

import {DeckSourceMapSchema} from '@video-agent/ir'

export function createDeckSourceMap(input: {
  inputPath: string
  language: string
  sourceType: Document['source']['sourceType']
  text: string
  title?: string
}): DeckSourceMap {
  const sections = createSourceSections(input.text)
  const title = input.title ?? inferSourceTitle(sections)

  return DeckSourceMapSchema.parse({
    generatedAt: new Date().toISOString(),
    language: input.language,
    sections,
    source: {
      language: input.language,
      path: input.inputPath,
      sourceType: input.sourceType,
      ...(title === undefined ? {} : {title}),
    },
    ...(title === undefined ? {} : {title}),
    version: 1,
  })
}

function createSourceSections(text: string): DeckSourceSection[] {
  const lines = text.split(/\r?\n/)
  const offsets = createLineOffsets(text, lines)
  const headingStack: string[] = []
  const sections: DeckSourceSection[] = []
  let index = 0
  let inFrontmatter = false
  let inCode = false
  let codeStart = 0
  let codeLines: string[] = []

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (index === 0 && trimmed === '---') {
      inFrontmatter = true
      const start = index
      index += 1

      while (index < lines.length && (lines[index] ?? '').trim() !== '---') {
        index += 1
      }

      const end = Math.min(index + 1, lines.length)
      pushSection(sections, {
        headingPath: [],
        kind: 'frontmatter',
        lines: lines.slice(start, end),
        range: lineRange(offsets, text.length, start, end),
      })
      inFrontmatter = false
      index = end
      continue
    }

    if (inFrontmatter) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (!inCode) {
        inCode = true
        codeStart = index
        codeLines = [line]
        index += 1
        continue
      }

      codeLines.push(line)
      pushSection(sections, {
        headingPath: [...headingStack],
        kind: 'code',
        lines: codeLines,
        range: lineRange(offsets, text.length, codeStart, index + 1),
      })
      inCode = false
      codeLines = []
      index += 1
      continue
    }

    if (inCode) {
      codeLines.push(line)
      index += 1
      continue
    }

    const heading = parseHeading(trimmed)

    if (heading !== undefined) {
      headingStack.splice(heading.level - 1)
      headingStack.push(heading.title)
      pushSection(sections, {
        headingPath: [...headingStack],
        kind: 'heading',
        lines: [heading.title],
        range: lineRange(offsets, text.length, index, index + 1),
      })
      index += 1
      continue
    }

    if (trimmed === '') {
      index += 1
      continue
    }

    const kind = classifyStructuralLine(trimmed)
    const start = index
    const blockLines = [line]
    index += 1

    while (index < lines.length) {
      const candidate = lines[index] ?? ''
      const candidateTrimmed = candidate.trim()

      if (
        candidateTrimmed === ''
        || parseHeading(candidateTrimmed) !== undefined
        || candidateTrimmed.startsWith('```')
        || candidateTrimmed.startsWith('~~~')
        || classifyStructuralLine(candidateTrimmed) !== kind
      ) {
        break
      }

      blockLines.push(candidate)
      index += 1
    }

    pushSection(sections, {
      headingPath: [...headingStack],
      kind,
      lines: blockLines,
      range: lineRange(offsets, text.length, start, index),
    })
  }

  if (sections.length === 0) {
    pushSection(sections, {
      headingPath: [],
      kind: 'paragraph',
      lines: [text],
      range: [0, Math.max(1, text.length)],
    })
  }

  return sections.map((section, sectionIndex) => ({
    ...section,
    id: `source-section-${String(sectionIndex + 1).padStart(3, '0')}`,
  }))
}

function pushSection(
  sections: Array<Omit<DeckSourceSection, 'id'>>,
  input: {
    headingPath: string[]
    kind: DeckSourceSection['kind']
    lines: string[]
    range: [number, number]
  },
): void {
  const text = input.lines.join('\n').trim()

  if (text === '') {
    return
  }

  sections.push({
    headingPath: input.headingPath,
    kind: input.kind,
    sourceRange: input.range,
    text,
  })
}

function parseHeading(trimmed: string): {level: number; title: string} | undefined {
  const match = /^(#{1,6})\s+(.+?)\s*#*$/u.exec(trimmed)

  if (match === null) {
    return undefined
  }

  return {
    level: match[1]?.length ?? 1,
    title: match[2]?.trim() ?? trimmed,
  }
}

function classifyStructuralLine(trimmed: string): DeckSourceSection['kind'] {
  if (/^[-*+]\s+/u.test(trimmed) || /^\d+[.)]\s+/u.test(trimmed)) {
    return 'list'
  }

  if (trimmed.includes('|')) {
    return 'table'
  }

  return 'paragraph'
}

function createLineOffsets(text: string, lines: string[]): number[] {
  const offsets: number[] = []
  let cursor = 0

  for (const line of lines) {
    offsets.push(cursor)
    cursor += line.length + 1
  }

  return offsets
}

function lineRange(offsets: number[], textLength: number, startLine: number, endLineExclusive: number): [number, number] {
  const start = offsets[startLine] ?? 0
  const end = Math.min(textLength, offsets[endLineExclusive] ?? textLength)

  return [start, Math.max(start + 1, end)]
}

function inferSourceTitle(sections: DeckSourceSection[]): string | undefined {
  const heading = sections.find((section) => section.kind === 'heading')

  return heading?.text.split('\n')[0]?.trim()
}

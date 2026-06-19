import type {Claim, Claims, ContentBlock, Document, SourceQuote, SourceQuotes} from '@video-agent/ir'

export function createClaimsFromDocument(document: Document): Claims {
  const claimBlocks = document.blocks.filter((block) => ['claim', 'data', 'recommendation', 'summary'].includes(block.type))

  return {
    claims: claimBlocks.map((block, index): Claim => ({
      blockId: block.id,
      confidence: confidenceForContentBlock(block),
      evidence: block.evidence,
      id: `claim-${String(index + 1).padStart(3, '0')}`,
      text: block.text,
      type: block.type as Claim['type'],
    })),
    version: 1,
  }
}

export function createSourceQuotesFromDocument(document: Document): SourceQuotes {
  return {
    quotes: document.blocks.map((block, index): SourceQuote => ({
      blockId: block.id,
      evidence: block.evidence,
      id: `quote-${String(index + 1).padStart(3, '0')}`,
      ...(block.sourceRange === undefined ? {} : {sourceRange: block.sourceRange}),
      text: block.text,
    })),
    version: 1,
  }
}

function confidenceForContentBlock(block: ContentBlock): number {
  if (block.evidence.length > 0) {
    return 0.9
  }

  if (block.type === 'data') {
    return 0.8
  }

  if (block.type === 'summary') {
    return 0.75
  }

  return 0.7
}

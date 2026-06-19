import type {DeckTemplateManifestEntry} from '../define-template.js'

export const quoteManifest = {
  description: 'Quote emphasis slide.',
  fields: ['title', 'quote.text', 'quote.attribution'],
  limits: {
    quote_chars: 96,
    title_chars: 24,
  },
  motionPresets: ['soft-scale', 'fade-in', 'blur-rise'],
  qualityRules: {
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.quote-block'],
    safeArea: true,
  },
  repair: 'fallback-readable',
  type: 'quote',
  useWhen: 'Highlighting a source quote or memorable sentence.',
} satisfies DeckTemplateManifestEntry

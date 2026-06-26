import type {DeckTemplateManifestEntry} from '../define-template.js'

export const gridCardsManifest = {
  description: 'Grid of 2-4 cards with optional icons, labels, and descriptions.',
  fields: ['title', 'subtitle', 'gridCards.cards[].icon', 'gridCards.cards[].label', 'gridCards.cards[].description'],
  limits: {
    cards: 4,
    card_label_chars: 24,
    subtitle_chars: 42,
    title_chars: 28,
  },
  motionPresets: ['card-stack', 'stagger-up', 'progressive-reveal', 'blur-rise'],
  qualityRules: {
    maxPointLines: 1,
    maxPoints: 0,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.grid-card'],
    safeArea: true,
  },
  type: 'grid-cards',
  useWhen: 'Showing a feature list, tool comparison, capability overview, or any set of 2-4 parallel items with optional icons.',
} satisfies DeckTemplateManifestEntry

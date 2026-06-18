import type {DeckTemplateManifestEntry} from '../define-template.js'

export const timelineManifest = {
  description: 'Ordered sequence over time.',
  fields: ['title', 'points'],
  limits: {
    items: 5,
    point_chars: 28,
    title_chars: 28,
  },
  motionPresets: ['line-draw', 'progressive-reveal', 'stagger-up'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 5,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.timeline__item'],
    safeArea: true,
  },
  repair: 'split-points',
  type: 'timeline',
  useWhen: 'Showing events, milestones, or state changes in chronological order.',
} satisfies DeckTemplateManifestEntry

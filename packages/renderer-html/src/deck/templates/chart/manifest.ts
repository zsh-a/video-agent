import type {DeckTemplateManifestEntry} from '../define-template.js'

export const chartManifest = {
  description: 'Simple qualitative chart slide.',
  fields: ['title', 'points'],
  limits: {
    bars: 4,
    point_chars: 28,
    title_chars: 28,
  },
  motionPresets: ['line-draw', 'stagger-up', 'progressive-reveal'],
  qualityRules: {
    maxPointLines: 1,
    maxPoints: 4,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.chart-bar'],
    safeArea: true,
  },
  repair: 'split-points',
  type: 'chart',
  useWhen: 'Showing a small set of comparable qualitative indicators.',
} satisfies DeckTemplateManifestEntry

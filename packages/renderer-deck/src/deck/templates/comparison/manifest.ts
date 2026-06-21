import type {DeckTemplateManifestEntry} from '../define-template.js'

export const comparisonManifest = {
  description: 'Two-sided comparison with balanced labels and concise point lists.',
  fields: ['title', 'comparison.left.label', 'comparison.left.points', 'comparison.right.label', 'comparison.right.points'],
  limits: {
    left_points: 3,
    point_chars: 40,
    right_points: 3,
    title_chars: 28,
  },
  motionPresets: ['card-stack', 'blur-rise', 'progressive-reveal'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 6,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.comparison__side'],
    safeArea: true,
  },
  type: 'comparison',
  useWhen: 'Comparing two options, concepts, architectures, states, or tradeoffs.',
} satisfies DeckTemplateManifestEntry

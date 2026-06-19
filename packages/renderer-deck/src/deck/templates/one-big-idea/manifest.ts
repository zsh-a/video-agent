import type {DeckTemplateManifestEntry} from '../define-template.js'

export const oneBigIdeaManifest = {
  description: 'Single insight slide with one primary statement and optional supporting context.',
  fields: ['title', 'subtitle', 'points'],
  limits: {
    points: 3,
    point_chars: 36,
    title_chars: 28,
  },
  motionPresets: ['progressive-reveal', 'blur-rise', 'soft-scale'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 3,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.idea-card'],
    safeArea: true,
  },
  repair: 'split-points',
  type: 'one-big-idea',
  useWhen: 'Explaining one key idea, claim, or takeaway without parallel structure.',
} satisfies DeckTemplateManifestEntry

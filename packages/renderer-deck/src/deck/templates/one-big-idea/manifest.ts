import type {DeckTemplateManifestEntry} from '../define-template.js'

export const oneBigIdeaManifest = {
  description: 'Single insight slide with one primary statement and optional supporting context.',
  fields: ['title', 'subtitle', 'points'],
  limits: {
    points: 3,
    point_chars: 40,
    title_chars: 28,
  },
  motionPresets: ['progressive-reveal', 'blur-rise', 'soft-scale'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 3,
    minPoints: 1,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.idea-card'],
    safeArea: true,
  },
  type: 'one-big-idea',
  useWhen: 'Explaining one key idea, claim, or takeaway without parallel structure.',
} satisfies DeckTemplateManifestEntry

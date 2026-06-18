import type {DeckTemplateManifestEntry} from '../define-template.js'

export const summaryManifest = {
  description: 'Summary slide with final takeaways.',
  fields: ['title', 'points'],
  limits: {
    point_chars: 30,
    points: 4,
    title_chars: 28,
  },
  motionPresets: ['progressive-reveal', 'stagger-up', 'fade-in'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 4,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.point'],
    safeArea: true,
  },
  repair: 'split-points',
  type: 'summary',
  useWhen: 'Summarizing takeaways, conclusions, or final recommendations.',
} satisfies DeckTemplateManifestEntry

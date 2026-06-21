import type {DeckTemplateManifestEntry} from '../define-template.js'

export const statManifest = {
  description: 'Large number or metric slide.',
  fields: ['title', 'stat.value', 'stat.label', 'stat.caption', 'points'],
  limits: {
    point_chars: 40,
    points: 3,
    title_chars: 24,
  },
  motionPresets: ['number-count', 'spotlight', 'soft-scale'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 3,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.stat-block'],
    safeArea: true,
  },
  type: 'stat',
  useWhen: 'Emphasizing one meaningful metric with label and context.',
} satisfies DeckTemplateManifestEntry

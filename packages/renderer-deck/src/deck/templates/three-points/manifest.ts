import type {DeckTemplateManifestEntry} from '../define-template.js'

export const threePointsManifest = {
  description: 'Three parallel points under one topic.',
  fields: ['title', 'points'],
  limits: {
    point_chars: 28,
    points: 3,
    title_chars: 28,
  },
  motionPresets: ['progressive-reveal', 'stagger-up', 'blur-rise'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 3,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.point'],
    safeArea: true,
  },
  type: 'three-points',
  useWhen: 'Explaining three parallel principles, reasons, criteria, or steps.',
} satisfies DeckTemplateManifestEntry

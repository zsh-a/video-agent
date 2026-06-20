import type {DeckTemplateManifestEntry} from '../define-template.js'

export const heroManifest = {
  description: 'Opening or chapter title slide with a strong visual hierarchy.',
  fields: ['title', 'subtitle', 'points'],
  limits: {
    points: 2,
    point_chars: 28,
    subtitle_chars: 42,
    title_chars: 24,
  },
  motionPresets: ['cinematic-rise', 'blur-rise', 'fade-in'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 2,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title'],
    safeArea: true,
  },
  type: 'hero',
  useWhen: 'Opening title, chapter title, or strong point introduction.',
} satisfies DeckTemplateManifestEntry

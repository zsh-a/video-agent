import type {DeckTemplateManifestEntry} from '../define-template.js'

export const ctaManifest = {
  description: 'Final call-to-action slide.',
  fields: ['title', 'subtitle', 'points'],
  limits: {
    points: 1,
    subtitle_chars: 42,
    title_chars: 24,
  },
  motionPresets: ['zoom-focus', 'soft-scale', 'fade-in'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 1,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.cta-block'],
    safeArea: true,
  },
  repair: 'fallback-readable',
  type: 'cta',
  useWhen: 'Ending the deck with one next step or closing message.',
} satisfies DeckTemplateManifestEntry

import type {DeckTemplateManifestEntry} from '../define-template.js'

export const sectionManifest = {
  description: 'Section divider for a new topic or chapter.',
  fields: ['title', 'subtitle'],
  limits: {
    subtitle_chars: 42,
    title_chars: 24,
  },
  motionPresets: ['wipe', 'fade-in'],
  qualityRules: {
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.section__rule'],
    safeArea: true,
  },
  type: 'section',
  useWhen: 'Separating chapters, major topics, or narrative beats.',
} satisfies DeckTemplateManifestEntry

import type {DeckTemplateManifestEntry} from '../define-template.js'

export const codeManifest = {
  description: 'Code or structured text slide.',
  fields: ['title', 'code.language', 'code.text'],
  limits: {
    code_lines: 12,
    title_chars: 28,
  },
  motionPresets: ['blur-rise', 'progressive-reveal'],
  qualityRules: {
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.code-block'],
    safeArea: true,
  },
  type: 'code',
  useWhen: 'Explaining short code, configuration, schema, or structured text.',
} satisfies DeckTemplateManifestEntry

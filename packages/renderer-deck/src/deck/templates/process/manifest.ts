import type {DeckTemplateManifestEntry} from '../define-template.js'

export const processManifest = {
  description: 'Ordered process or pipeline slide.',
  fields: ['title', 'process.steps'],
  limits: {
    step_detail_chars: 72,
    step_label_chars: 32,
    steps: 7,
    title_chars: 28,
  },
  motionPresets: ['progressive-reveal', 'stagger-up', 'line-draw'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 7,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.process-list .point'],
    safeArea: true,
  },
  type: 'process',
  useWhen: 'Describing a workflow, pipeline, lifecycle, or ordered phase sequence.',
} satisfies DeckTemplateManifestEntry

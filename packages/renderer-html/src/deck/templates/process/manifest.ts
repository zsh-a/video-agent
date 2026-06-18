import type {DeckTemplateManifestEntry} from '../define-template.js'

export const processManifest = {
  description: 'Ordered process or pipeline slide.',
  fields: ['title', 'points'],
  limits: {
    point_chars: 28,
    steps: 5,
    title_chars: 28,
  },
  motionPresets: ['progressive-reveal', 'stagger-up', 'line-draw'],
  qualityRules: {
    maxPointLines: 2,
    maxPoints: 5,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.process-list .point'],
    safeArea: true,
  },
  repair: 'split-points',
  type: 'process',
  useWhen: 'Describing a workflow, pipeline, lifecycle, or ordered phase sequence.',
} satisfies DeckTemplateManifestEntry

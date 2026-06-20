import type {DeckTemplateManifestEntry} from '../define-template.js'

export const chartManifest = {
  description: 'Small normalized bar chart slide with LLM-authored labels and values.',
  fields: ['title', 'chart.bars.label', 'chart.bars.value', 'chart.bars.caption'],
  limits: {
    bars: 4,
    point_chars: 28,
    title_chars: 28,
  },
  motionPresets: ['line-draw', 'stagger-up', 'progressive-reveal'],
  qualityRules: {
    maxPointLines: 1,
    maxPoints: 4,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.chart-bar'],
    safeArea: true,
  },
  type: 'chart',
  useWhen: 'Showing a small set of comparable qualitative indicators.',
} satisfies DeckTemplateManifestEntry

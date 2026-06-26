import type {DeckTemplateManifestEntry} from '../define-template.js'

export const chartManifest = {
  description: 'Bar chart or donut chart slide with LLM-authored labels and values.',
  fields: ['title', 'chart.type', 'chart.bars.label', 'chart.bars.value', 'chart.bars.caption', 'chart.valueLabel'],
  limits: {
    bars: 4,
    point_chars: 40,
    title_chars: 28,
  },
  motionPresets: ['line-draw', 'stagger-up', 'progressive-reveal', 'card-stack'],
  qualityRules: {
    maxPointLines: 1,
    maxPoints: 4,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.chart-bar, .donut-ring'],
    safeArea: true,
  },
  type: 'chart',
  useWhen: 'Showing a small set of comparable qualitative indicators (bar) or proportional breakdown (donut). Set chart.type to "donut" for pie-style charts.',
} satisfies DeckTemplateManifestEntry

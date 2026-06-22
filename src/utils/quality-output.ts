import type {RenderSummary} from '@video-agent/runtime'

export function formatQualityRenderSummary(render: RenderSummary): string {
  const errors = render.outputErrors + render.subtitleErrors + render.audioQualityErrors + render.templateErrors + render.visualErrors
  const warnings = render.outputWarnings + render.subtitleWarnings + render.audioWarnings + render.audioQualityWarnings + render.templateWarnings + render.visualWarnings + render.missingVoiceovers
  const status = render.rendered ? 'rendered' : 'not rendered'

  return [
    `${status}, ${errors} errors, ${warnings} warnings`,
    `output ${render.outputErrors}/${render.outputWarnings}`,
    `subtitle ${render.subtitleErrors}/${render.subtitleWarnings}`,
    `audio ${render.audioQualityErrors}/${render.audioQualityWarnings + render.audioWarnings + render.missingVoiceovers}`,
    `template ${render.templateErrors}/${render.templateWarnings}`,
    `visual ${render.visualErrors}/${render.visualWarnings}`,
    `review ${render.reviewAvailable ? 'available' : 'none'}`,
  ].join(', ')
}

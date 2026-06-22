export const FFMPEG_RENDER_OUTPUT_RENDERER = 'ffmpeg' as const
export const HTML_RENDER_OUTPUT_RENDERER = 'html' as const
export const REMOTION_RENDER_OUTPUT_RENDERER = 'remotion' as const

export const RENDER_OUTPUT_RENDERERS = [
  FFMPEG_RENDER_OUTPUT_RENDERER,
  HTML_RENDER_OUTPUT_RENDERER,
  REMOTION_RENDER_OUTPUT_RENDERER,
] as const

export type RenderOutputRenderer = (typeof RENDER_OUTPUT_RENDERERS)[number]
export type FfmpegRenderOutputRenderer = typeof FFMPEG_RENDER_OUTPUT_RENDERER

import type {DeckHtmlCaptureBackend} from '@video-agent/ir'

export const DECK_RENDERER_BACKENDS = ['motion-canvas', 'remotion'] as const

export type DeckRendererBackend = (typeof DECK_RENDERER_BACKENDS)[number]

export const DECK_HTML_VIDEO_RENDERERS = ['chromium+ffmpeg', 'playwright+ffmpeg'] as const

export type DeckHtmlVideoRenderer = (typeof DECK_HTML_VIDEO_RENDERERS)[number]

export const DECK_HTML_VIDEO_RENDERER_BY_CAPTURE_BACKEND = {
  chromium: 'chromium+ffmpeg',
  playwright: 'playwright+ffmpeg',
} as const satisfies Record<DeckHtmlCaptureBackend, DeckHtmlVideoRenderer>

export const DECK_REMOTION_VIDEO_RENDERER = 'remotion+ffmpeg' as const

export type DeckRemotionVideoRenderer = typeof DECK_REMOTION_VIDEO_RENDERER

export const DECK_VIDEO_RENDERERS = [...DECK_HTML_VIDEO_RENDERERS, DECK_REMOTION_VIDEO_RENDERER] as const

export type DeckVideoRenderer = (typeof DECK_VIDEO_RENDERERS)[number]

export function deckHtmlVideoRendererForCaptureBackend(backend: DeckHtmlCaptureBackend): DeckHtmlVideoRenderer {
  return DECK_HTML_VIDEO_RENDERER_BY_CAPTURE_BACKEND[backend]
}

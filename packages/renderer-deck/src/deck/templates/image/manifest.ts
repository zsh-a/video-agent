import type {DeckTemplateManifestEntry} from '../define-template.js'

export const imageManifest = {
  description: 'Image-focused slide for screenshots, photos, video frames, or diagrams.',
  fields: ['title', 'subtitle', 'image.src', 'image.alt', 'image.caption'],
  limits: {
    subtitle_chars: 48,
    title_chars: 28,
  },
  motionPresets: ['blur-rise', 'soft-scale', 'fade-in', 'cinematic-rise'],
  qualityRules: {
    maxPointLines: 1,
    maxPoints: 0,
    maxTitleLines: 2,
    requiredVisibleElements: ['.slide__title', '.image-frame'],
    safeArea: true,
  },
  type: 'image',
  useWhen: 'Showing a screenshot, photo, video frame, diagram, or any visual that needs prominent display.',
} satisfies DeckTemplateManifestEntry

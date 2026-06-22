import {expect} from '#test/expect'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {TimedDeck} from '../../../packages/ir/src/index.js'
import type {RenderedMediaQualityResult, SubtitleQualityResult, VisualSmokeQualityResult} from '../../../packages/quality/src/index.js'

import {TIMED_DECK_ARTIFACT_NAME} from '../../../packages/ir/src/index.js'
import {DECK_KEYFRAME_CAPTURE_MODE_FINAL_VIDEO, DECK_REMOTION_VIDEO_RENDERER} from '../../../packages/runtime/src/index.js'
import {createProjectWorkspace} from '../../../packages/runtime/src/shared/workspace.js'
import {createDeckFinalVideoKeyframeQuality} from '../../../packages/pipeline-deck/src/quality/keyframes.js'
import {createDeckQualityReport} from '../../../packages/pipeline-deck/src/quality/report.js'
import {type DeckKeyframeArtifact, writeDeckReviewArtifacts} from '../../../packages/pipeline-deck/src/quality/review.js'

describe('Deck review quality validation', () => {
  it('rejects final-video keyframe fps instead of coercing it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-keyframe-quality-'))

    try {
      const workspace = await createProjectWorkspace({projectId: 'demo', workspaceDir: root})
      let error: unknown

      try {
        await createDeckFinalVideoKeyframeQuality(workspace, createTimedDeck(), join(workspace.rendersDir, 'final.mp4'), 29.97)
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('Deck final-video keyframe quality fps must be a positive integer; no runtime integer coercion fallback is allowed. Received: 29.97')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects final-video keyframe timing instead of clamping it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-keyframe-timing-'))

    try {
      const workspace = await createProjectWorkspace({projectId: 'demo', workspaceDir: root})
      const timedDeck = createTimedDeck({end: 2, slideId: 'slide-001', start: 4})
      let error: unknown

      try {
        await createDeckFinalVideoKeyframeQuality(workspace, timedDeck, join(workspace.rendersDir, 'final.mp4'), 30)
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('Deck final-video keyframe quality requires timing end to be greater than start for slide "slide-001"; no timing clamp fallback is allowed. Received start=4 end=2')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })

  it('rejects review report timing instead of writing clamped slide durations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'video-agent-deck-review-timing-'))

    try {
      const workspace = await createProjectWorkspace({projectId: 'demo', workspaceDir: root})
      const validTimedDeck = createTimedDeck()
      const invalidTimedDeck = createTimedDeck({end: Number.NaN, slideId: 'slide-001', start: 0})
      let error: unknown

      try {
        await writeDeckReviewArtifacts({
          deckQualityReport: createDeckQualityReport(validTimedDeck),
          keyframeQuality: {
            artifact: createDeckKeyframeArtifact(),
            visualQuality: emptyVisualQuality(),
          },
          keyframeQualityPath: workspace.store.resolve('deck-keyframes.json'),
          outputPath: join(workspace.rendersDir, 'final.mp4'),
          outputQuality: emptyRenderedQuality(),
          projectId: workspace.projectId,
          subtitleQuality: emptySubtitleQuality(),
          timedDeck: invalidTimedDeck,
          videoRenderer: DECK_REMOTION_VIDEO_RENDERER,
          workspace,
        })
      } catch (caught) {
        error = caught
      }

      expect(String(error)).to.include('Deck review artifact requires timing end to be greater than start for slide "slide-001"; no timing clamp fallback is allowed. Received start=0 end=NaN')
    } finally {
      await rm(root, {force: true, recursive: true})
    }
  })
})

function createTimedDeck(timing: TimedDeck['timings'][number] = {end: 4, slideId: 'slide-001', start: 0}): TimedDeck {
  return {
    deck: {
      format: 'landscape_1920x1080',
      inputMode: 'script-generated',
      language: 'en-US',
      slides: [
        {
          blockIds: [],
          evidence: [],
          motion: 'soft-scale',
          points: ['One evidence-backed point.'],
          slideId: 'slide-001',
          title: 'Opening',
          type: 'summary',
        },
      ],
      theme: 'elegant-dark',
      title: 'Demo Deck',
      version: 1,
    },
    timings: [timing],
    version: 1,
  }
}

function createDeckKeyframeArtifact(): DeckKeyframeArtifact {
  return {
    captureMode: DECK_KEYFRAME_CAPTURE_MODE_FINAL_VIDEO,
    duration: 4,
    fps: 30,
    generatedAt: '2026-06-22T00:00:00.000Z',
    renderer: 'remotion',
    samples: [],
    source: TIMED_DECK_ARTIFACT_NAME,
    version: 1,
    viewport: {
      height: 1080,
      width: 1920,
    },
  }
}

function emptyVisualQuality(): VisualSmokeQualityResult {
  return {
    blackDuration: 0,
    blackSegments: [],
    errors: 0,
    issues: [],
    probed: true,
    warnings: 0,
  }
}

function emptyRenderedQuality(): RenderedMediaQualityResult {
  return {
    audioStreams: 1,
    errors: 0,
    issues: [],
    probed: true,
    subtitleStreams: 1,
    videoStreams: 1,
    warnings: 0,
  }
}

function emptySubtitleQuality(): SubtitleQualityResult {
  return {
    cues: 1,
    errors: 0,
    issues: [],
    warnings: 0,
  }
}

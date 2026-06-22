import {describe, expect, it} from 'bun:test'

import {checkExplainerStructure} from '../../../packages/quality/src/index.js'

describe('explainer structure quality', () => {
  it('warns when a long-video explainer collapses into one non-slide narration segment', () => {
    const issues = checkExplainerStructure({
      mediaInfo: {
        duration: 237.666,
        formatName: 'mov,mp4',
        inputPath: '/tmp/input.mp4',
        streams: [{codecName: 'h264', duration: 237.666, fps: 30, height: 1080, type: 'video', width: 1920}],
      },
      narration: {
        language: 'zh-CN',
        segments: [{duration: 237.666, id: 'chunk-000-moment-001', start: 0, text: 'x'.repeat(1567)}],
        version: 1,
      },
      selectedMoments: {
        moments: [
          {
            chunkId: 'chunk-000',
            evidence: [],
            id: 'chunk-000-moment-001',
            reason: 'deterministic',
            sourceRange: [0, 237.666],
            summary: 'single collapsed moment',
          },
        ],
        source: '/tmp/input.mp4',
        version: 1,
      },
      storyboard: {
        language: 'zh-CN',
        scenes: [{duration: 237.666, id: 'chunk-000-moment-001', sourceRange: [0, 237.666], start: 0, visualStyle: 'app_demo'}],
        targetPlatform: 'generic',
        version: 1,
      },
    })

    const codes = issues.map((issue) => issue.code)

    for (const code of [
      'explainer.selected_moments.too_few',
      'explainer.storyboard.visual_style',
      'explainer.storyboard.segment_too_long',
      'explainer.narration.segment_too_long',
      'explainer.narration.text_too_long',
    ]) {
      expect(codes).toContain(code)
    }
  })

  it('passes a multi-slide explainer structure', () => {
    const issues = checkExplainerStructure({
      mediaInfo: {
        duration: 70,
        formatName: 'mov,mp4',
        inputPath: '/tmp/input.mp4',
        streams: [{codecName: 'h264', duration: 70, fps: 30, height: 1080, type: 'video', width: 1920}],
      },
      narration: {
        language: 'zh-CN',
        segments: [
          {duration: 30, id: 'scene-1', sceneId: 'scene-1', start: 0, text: '第 1 页：讲解第一部分'},
          {duration: 40, id: 'scene-2', sceneId: 'scene-2', start: 30, text: '第 2 页：讲解第二部分'},
        ],
        version: 1,
      },
      selectedMoments: {
        moments: [
          {chunkId: 'chunk-000', evidence: [], id: 'moment-1', reason: 'range', sourceRange: [0, 30], summary: '第 1 页：讲解第一部分'},
          {chunkId: 'chunk-000', evidence: [], id: 'moment-2', reason: 'range', sourceRange: [30, 70], summary: '第 2 页：讲解第二部分'},
        ],
        source: '/tmp/input.mp4',
        version: 1,
      },
      storyboard: {
        language: 'zh-CN',
        scenes: [
          {duration: 30, id: 'scene-1', sourceRange: [0, 30], start: 0, visualStyle: 'slide_explainer'},
          {duration: 40, id: 'scene-2', sourceRange: [30, 70], start: 30, visualStyle: 'slide_explainer'},
        ],
        targetPlatform: 'generic',
        version: 1,
      },
    })

    expect(issues).toEqual([])
  })

  it('reports missing media duration instead of inferring it from selected moments', () => {
    const issues = checkExplainerStructure({
      mediaInfo: {
        formatName: 'mov,mp4',
        inputPath: '/tmp/input.mp4',
        streams: [{codecName: 'h264', fps: 30, height: 1080, type: 'video', width: 1920}],
      },
      narration: {
        language: 'zh-CN',
        segments: [{duration: 70, id: 'scene-1', sceneId: 'scene-1', start: 0, text: '第 1 页：讲解第一部分'}],
        version: 1,
      },
      selectedMoments: {
        moments: [{chunkId: 'chunk-000', evidence: [], id: 'moment-1', reason: 'range', sourceRange: [0, 70], summary: '第 1 页：讲解第一部分'}],
        source: '/tmp/input.mp4',
        version: 1,
      },
      storyboard: {
        language: 'zh-CN',
        scenes: [{duration: 70, id: 'scene-1', sourceRange: [0, 70], start: 0, visualStyle: 'slide_explainer'}],
        targetPlatform: 'generic',
        version: 1,
      },
    })

    expect(issues.map((issue) => issue.code)).toEqual(['explainer.media.duration_missing'])
  })

  it('reports missing narration duration instead of treating it as zero', () => {
    const issues = checkExplainerStructure({
      mediaInfo: {
        duration: 70,
        formatName: 'mov,mp4',
        inputPath: '/tmp/input.mp4',
        streams: [{codecName: 'h264', duration: 70, fps: 30, height: 1080, type: 'video', width: 1920}],
      },
      narration: {
        language: 'zh-CN',
        segments: [{id: 'scene-1', sceneId: 'scene-1', start: 0, text: '第 1 页：讲解第一部分'}],
        version: 1,
      },
      selectedMoments: {
        moments: [{chunkId: 'chunk-000', evidence: [], id: 'moment-1', reason: 'range', sourceRange: [0, 70], summary: '第 1 页：讲解第一部分'}],
        source: '/tmp/input.mp4',
        version: 1,
      },
      storyboard: {
        language: 'zh-CN',
        scenes: [{duration: 70, id: 'scene-1', sourceRange: [0, 70], start: 0, visualStyle: 'slide_explainer'}],
        targetPlatform: 'generic',
        version: 1,
      },
    })

    expect(issues).toContainEqual({
      code: 'explainer.narration.duration_missing',
      message: 'Long-video explainer contains 1 narration segment(s) without LLM-authored duration; no zero-duration narration fallback is allowed.',
      severity: 'error',
    })
  })
})

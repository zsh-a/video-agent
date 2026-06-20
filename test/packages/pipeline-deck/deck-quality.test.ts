import {expect} from '#test/expect'

import {assertDeckQualityReportHasNoErrors, createDeckQualityReport, createTextQualityIssues} from '../../../packages/pipeline-deck/src/quality/report.js'

describe('Deck quality report', () => {
	  it('errors when semantic templates are missing required content instead of relying on render fallbacks', () => {
	    const report = createDeckQualityReport({
      deck: {
        format: 'portrait_1080x1920',
        inputMode: 'script-generated',
        language: 'zh-CN',
        slides: [
          {
            blockIds: [],
            evidence: [],
            motion: 'progressive-reveal',
            points: [],
            slideId: 'slide-idea',
            title: 'Idea',
            transitionOut: {duration: 0.55, type: 'crossfade'},
            type: 'one-big-idea',
          },
          {
            blockIds: [],
            evidence: [],
            motion: 'progressive-reveal',
            points: [],
            slideId: 'slide-chart',
            title: 'Chart',
            transitionOut: {duration: 0.55, type: 'crossfade'},
            type: 'chart',
          },
          {
            blockIds: [],
            evidence: [],
            motion: 'soft-scale',
            points: [],
            slideId: 'slide-quote',
            title: 'Quote',
            transitionOut: {duration: 0.55, type: 'crossfade'},
            type: 'quote',
          },
          {
            blockIds: [],
            evidence: [],
            motion: 'blur-rise',
            points: [],
            slideId: 'slide-code',
            title: 'Code',
            transitionOut: {duration: 0.55, type: 'crossfade'},
            type: 'code',
          },
          {
            blockIds: [],
            evidence: [],
            motion: 'zoom-focus',
            points: [],
            slideId: 'slide-cta',
            title: 'CTA',
            type: 'cta',
          },
        ],
        theme: 'elegant-dark',
        title: 'Bad Deck',
        version: 1,
      },
      timings: [
        {end: 4, slideId: 'slide-idea', start: 0},
        {end: 8, slideId: 'slide-chart', start: 4},
        {end: 12, slideId: 'slide-quote', start: 8},
        {end: 16, slideId: 'slide-code', start: 12},
        {end: 20, slideId: 'slide-cta', start: 16},
      ],
      version: 1,
    })

    expect(report.issues.map((issue) => issue.code)).to.include.members([
      'deck.chart_missing_data',
      'deck.idea_missing_statement',
      'deck.quote_missing_text',
      'deck.code_missing_block',
      'deck.cta_missing_action',
    ])
	    expect(report.summary.errors).to.be.greaterThan(4)
	  })

	  it('refuses to render or export deck output when quality errors are present', () => {
	    const report = createDeckQualityReport({
	      deck: {
	        format: 'portrait_1080x1920',
	        inputMode: 'script-generated',
	        language: 'en-US',
	        slides: [
	          {
	            blockIds: [],
	            evidence: [],
	            motion: 'progressive-reveal',
	            points: ['This visible point exceeds the one-big-idea template limit'],
	            slideId: 'slide-001',
	            title: 'Oversized idea',
	            type: 'one-big-idea',
	          },
	        ],
	        theme: 'elegant-dark',
	        title: 'Invalid Deck',
	        version: 1,
	      },
	      timings: [
	        {end: 4, slideId: 'slide-001', start: 0},
	      ],
	      version: 1,
	    })

	    expect(() => assertDeckQualityReportHasNoErrors(report, 'artifacts/deck-quality-report.json'))
	      .to.throw('refusing to render/export invalid Deck output')
	  })

	  it('does not require Deck storyboard visualStyle to match the long-video slide_explainer label', () => {
    const issues = createTextQualityIssues({
      mediaInfo: {
        duration: 12,
        formatName: 'text/plain',
        inputPath: '/tmp/deck.md',
        probedAt: '2026-01-01T00:00:00.000Z',
        streams: [],
        version: 1,
      },
      narration: {
        language: 'en-US',
        segments: [
          {duration: 12, id: 'narration-1', sceneId: 'scene-1', start: 0, text: 'Explain the evidence-backed slide.'},
        ],
        version: 1,
      },
      selectedMoments: {
        moments: [
          {
            chunkId: 'text-000',
            evidence: [],
            id: 'text-slide-001',
            reason: 'The LLM selected this moment for the deck.',
            score: 0.9,
            sourceRange: [0, 12],
            summary: 'Evidence-backed slide.',
            title: 'Evidence',
          },
        ],
        source: '/tmp/deck.md',
        version: 1,
      },
      storyboard: {
        language: 'en-US',
        scenes: [
          {
            duration: 12,
            evidence: [],
            id: 'scene-1',
            narration: 'Evidence-backed slide.',
            sourceRange: [0, 12],
            start: 0,
            visualStyle: 'dense technical evidence board',
          },
        ],
        targetPlatform: 'generic',
        version: 1,
      },
      timeline: {
        duration: 12,
        fps: 30,
        items: [],
        version: 1,
      },
    })

    expect(issues.map((issue) => issue.code)).to.not.include('explainer.storyboard.visual_style')
  })
})

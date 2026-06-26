import {expect} from '#test/expect'

import {BulletList, ProcessList, Timeline} from '../../../packages/renderer-deck/src/deck/components/index.js'
import {defineSlideTemplateModule, type SlideTemplateModule} from '../../../packages/renderer-deck/src/deck/templates/define-template.js'
import {findDeckTemplateManifestEntry, maxPointsForDeckTemplate, validateSlideAgainstTemplateManifest} from '../../../packages/renderer-deck/src/deck/templates/manifest.js'
import {resolveMotionStepsForTemplate, resolveSlideTemplate, slideTemplateModules, slideTemplateMotionSteps, slideTemplateRegistry, slideTemplateStyles} from '../../../packages/renderer-deck/src/deck/templates/registry.js'

describe('slideTemplateModules', () => {
  it('contains all 15 template types', () => {
    const types = slideTemplateModules.map((m) => m.template.type)

    expect(types).to.have.length(15)
    expect(types).to.include.members([
      'hero', 'section', 'one-big-idea', 'three-points', 'comparison',
      'process', 'timeline', 'quote', 'stat', 'chart', 'code', 'summary', 'cta',
      'image', 'grid-cards',
    ])
  })

  it('has consistent type between template and manifest for every module', () => {
    for (const module of slideTemplateModules) {
      expect(module.template.type).to.equal(module.manifest.type)
    }
  })

  it('has motionSteps defined for every module', () => {
    for (const module of slideTemplateModules) {
      expect(Array.isArray(module.motionSteps)).to.equal(true)
      expect(module.motionSteps!.length).to.be.greaterThan(0)
    }
  })

  it('collects available template styles without requiring renderer support for text CSS imports', () => {
    expect(slideTemplateStyles).to.have.length(15)

    for (const styles of slideTemplateStyles) {
      expect(styles).to.be.a('string')
      expect(styles.length).to.be.greaterThan(0)
    }
  })
})

describe('resolveSlideTemplate', () => {
  it('resolves each known type to its correct template', () => {
    for (const module of slideTemplateModules) {
      const resolved = resolveSlideTemplate(module.template.type)

      expect(resolved.type).to.equal(module.template.type)
    }
  })

  it('throws for unknown types instead of falling back to another template', () => {
    expect(() => resolveSlideTemplate('unknown-type' as Parameters<typeof resolveSlideTemplate>[0])).to.throw('No Deck template renderer registered')
  })

  it('throws when semantic templates are missing required renderer content', () => {
    expect(() => resolveSlideTemplate('chart').render({
      blockIds: [],
      evidence: [],
      motion: 'line-draw',
      points: ['Synthetic bar should not be enough'],
      slideId: 'slide-chart',
      title: 'Chart',
      type: 'chart',
    })).to.throw('missing chart data')

    expect(() => resolveSlideTemplate('code').render({
      blockIds: [],
      evidence: [],
      motion: 'blur-rise',
      points: [],
      slideId: 'slide-code',
      title: 'Code',
      type: 'code',
    })).to.throw('missing code block')

    expect(() => resolveSlideTemplate('quote').render({
      blockIds: [],
      evidence: [],
      motion: 'soft-scale',
      points: [],
      slideId: 'slide-quote',
      title: 'Quote',
      type: 'quote',
    })).to.throw('missing quote text')

    expect(() => resolveSlideTemplate('one-big-idea').render({
      blockIds: [],
      evidence: [],
      motion: 'soft-scale',
      points: [],
      slideId: 'slide-idea',
      subtitle: 'Do not use subtitle as the primary idea',
      title: 'Idea',
      type: 'one-big-idea',
    })).to.throw('missing an LLM-authored idea point')

    expect(() => resolveSlideTemplate('one-big-idea').render({
      blockIds: [],
      evidence: [],
      motion: 'soft-scale',
      points: ['Primary idea', 'Support one', 'Support two', 'Hidden support'],
      slideId: 'slide-idea-overflow',
      title: 'Idea',
      type: 'one-big-idea',
    })).to.throw('exceeding renderer limit 3')

    expect(() => resolveSlideTemplate('cta').render({
      blockIds: [],
      evidence: [],
      motion: 'zoom-focus',
      points: [],
      slideId: 'slide-cta',
      subtitle: 'Do not use subtitle as the action',
      title: 'Act',
      type: 'cta',
    })).to.throw('missing an LLM-authored action point')

    expect(() => resolveSlideTemplate('three-points').render({
      blockIds: [],
      evidence: [],
      motion: 'stagger-up',
      points: [],
      slideId: 'slide-three-points',
      title: 'Three Points',
      type: 'three-points',
    })).to.throw('missing visible points')

    expect(() => resolveSlideTemplate('summary').render({
      blockIds: [],
      evidence: [],
      motion: 'stagger-up',
      points: [],
      slideId: 'slide-summary',
      title: 'Summary',
      type: 'summary',
    })).to.throw('missing visible points')

    expect(() => resolveSlideTemplate('process').render({
      blockIds: [],
      evidence: [],
      motion: 'stagger-up',
      points: [],
      slideId: 'slide-process',
      title: 'Process',
      type: 'process',
    })).to.throw('missing visible process steps')

    expect(() => resolveSlideTemplate('timeline').render({
      blockIds: [],
      evidence: [],
      motion: 'line-draw',
      points: [],
      slideId: 'slide-timeline',
      title: 'Timeline',
      type: 'timeline',
    })).to.throw('missing visible points')

    expect(() => resolveSlideTemplate('image').render({
      blockIds: [],
      evidence: [],
      motion: 'blur-rise',
      points: [],
      slideId: 'slide-image',
      title: 'Image',
      type: 'image',
    })).to.throw('missing image data')

    expect(() => resolveSlideTemplate('grid-cards').render({
      blockIds: [],
      evidence: [],
      motion: 'card-stack',
      points: [],
      slideId: 'slide-grid',
      title: 'Grid',
      type: 'grid-cards',
    })).to.throw('missing grid cards data')
  })
})

describe('Deck visible point components', () => {
  it('throw on empty required visible content instead of rendering nothing', () => {
    expect(() => BulletList({className: 'points', max: 3, points: []})).to.throw('no empty list render fallback is allowed')
    expect(() => ProcessList({process: {steps: []}})).to.throw('no empty process render fallback is allowed')
    expect(() => Timeline({points: []})).to.throw('no empty timeline render fallback is allowed')
  })
})

describe('findDeckTemplateManifestEntry', () => {
  it('throws for unknown types instead of falling back to the first manifest', () => {
    expect(() => findDeckTemplateManifestEntry('unknown-type' as Parameters<typeof findDeckTemplateManifestEntry>[0])).to.throw('No Deck template manifest registered')
  })
})

describe('slideTemplateRegistry', () => {
  it('is a Map with all 15 types', () => {
    expect(slideTemplateRegistry.size).to.equal(15)
  })

  it('contains the same templates as slideTemplateModules', () => {
    for (const module of slideTemplateModules) {
      expect(slideTemplateRegistry.has(module.template.type)).to.equal(true)
    }
  })
})

describe('slideTemplateMotionSteps', () => {
  it('is a Map with all 15 types', () => {
    expect(slideTemplateMotionSteps.size).to.equal(15)
  })

  it('resolveMotionStepsForTemplate returns steps for all known types', () => {
    const types = ['hero', 'section', 'one-big-idea', 'three-points', 'comparison', 'process', 'timeline', 'quote', 'stat', 'chart', 'code', 'summary', 'cta', 'image', 'grid-cards'] as const

    for (const type of types) {
      const steps = resolveMotionStepsForTemplate(type)

      expect(Array.isArray(steps)).to.equal(true)
      expect(steps!.length).to.be.greaterThan(0)
    }
  })

  it('resolveMotionStepsForTemplate returns undefined for unknown type', () => {
    const steps = resolveMotionStepsForTemplate('unknown-type' as Parameters<typeof resolveMotionStepsForTemplate>[0])

    expect(steps).to.equal(undefined)
  })
})

describe('defineSlideTemplateModule', () => {
  it('returns the module when types match', () => {
    const module = slideTemplateModules[0]

    expect(defineSlideTemplateModule(module)).to.equal(module)
  })

  it('throws when template type does not match manifest type', () => {
    const module = slideTemplateModules[0]
    const badModule = {
      ...module,
      manifest: {...module.manifest, type: 'section'},
    }

    expect(() => defineSlideTemplateModule(badModule as SlideTemplateModule)).to.throw('does not match manifest type')
  })
})

describe('validateSlideAgainstTemplateManifest', () => {
  it('returns no issues for a valid slide', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'progressive-reveal',
      points: ['A', 'B', 'C'],
      slideId: 'slide-001',
      title: 'Test',
      type: 'three-points',
    })

    expect(issues).to.have.length(0)
  })

  it('returns no issues for a valid structured process slide', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'line-draw',
      points: [],
      process: {
        steps: [
          {detail: 'Check orders and capacity.', label: 'Separate demand'},
          {detail: 'Map volume and price to revenue.', label: 'Translate financials'},
          {detail: 'Confirm exposure and falsifiers.', label: 'Validate thesis'},
        ],
      },
      slideId: 'slide-process',
      title: 'Workflow',
      type: 'process',
    })

    expect(issues).to.have.length(0)
  })

  it('detects point overflow for three-points', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'progressive-reveal',
      points: ['A', 'B', 'C', 'D'],
      slideId: 'slide-001',
      title: 'Test',
      type: 'three-points',
    })

    expect(issues.some((issue) => issue.includes('point limit 3'))).to.equal(true)
  })

  it('allows concise mixed code and Chinese points in three-points slides', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'progressive-reveal',
      points: [
        '安装: pip install edgartools',
        '导入: from edgar import Company',
        '身份设置: EDGAR_IDENTITY=Name/Email',
      ],
      slideId: 'slide-sec',
      title: 'SEC助手',
      type: 'three-points',
    })

    expect(issues).to.have.length(0)
  })

  it('allows practical compact points up to the shared 40 character limit', () => {
    const slides: Parameters<typeof validateSlideAgainstTemplateManifest>[0][] = [
      {
        blockIds: [],
        evidence: [],
        motion: 'cinematic-rise',
        points: ['News to verifiable hypotheses'],
        slideId: 'slide-hero',
        title: 'Alpha',
        type: 'hero',
      },
      {
        blockIds: [],
        evidence: [],
        motion: 'soft-scale',
        points: [
          'Core question: Is demand observable?',
          'Evidence: orders, inventory, utilization',
          'If not observable, classify as watchlist',
        ],
        slideId: 'slide-idea',
        title: 'Demand Check',
        type: 'one-big-idea',
      },
      {
        blockIds: [],
        evidence: [],
        motion: 'spotlight',
        points: ['Higher value = greater price leverage'],
        slideId: 'slide-stat',
        stat: {label: 'Elasticity', value: '1-5'},
        title: 'Metric',
        type: 'stat',
      },
      {
        blockIds: [],
        evidence: [],
        motion: 'line-draw',
        points: ['Define confirm, weaken, falsify'],
        slideId: 'slide-timeline',
        title: 'Validation',
        type: 'timeline',
      },
      {
        blockIds: [],
        evidence: [],
        motion: 'stagger-up',
        points: ['Output is hypothesis, not advice'],
        slideId: 'slide-summary',
        title: 'Summary',
        type: 'summary',
      },
    ]

    for (const slide of slides) {
      expect(validateSlideAgainstTemplateManifest(slide)).to.have.length(0)
    }
  })

  it('detects title overflow', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'progressive-reveal',
      points: ['A'],
      slideId: 'slide-001',
      title: 'This title is way too long for the hero template',
      type: 'hero',
    })

    expect(issues.some((issue) => issue.includes('title'))).to.equal(true)
  })

  it('returns no issues for section with no points', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'progressive-reveal',
      points: [],
      slideId: 'slide-001',
      title: 'Section',
      type: 'section',
    })

    expect(issues).to.have.length(0)
  })

  it('detects per-point character overflow', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'progressive-reveal',
      points: ['This point is much too long for the hero point limit'],
      slideId: 'slide-001',
      title: 'Hero',
      type: 'hero',
    })

    expect(issues.some((issue) => issue.includes('point character limit 40'))).to.equal(true)
  })

  it('detects subtitle overflow', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'fade-in',
      points: [],
      slideId: 'slide-001',
      subtitle: 'This subtitle is too long for a section divider template',
      title: 'Section',
      type: 'section',
    })

    expect(issues.some((issue) => issue.includes('subtitle limit 42'))).to.equal(true)
  })

  it('detects required point underflow for templates with primary LLM-authored points', () => {
    const ideaIssues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'soft-scale',
      points: [],
      slideId: 'slide-idea',
      subtitle: 'Subtitle must not replace the idea point.',
      title: 'Idea',
      type: 'one-big-idea',
    })
    const ctaIssues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'zoom-focus',
      points: [],
      slideId: 'slide-cta',
      subtitle: 'Subtitle must not replace the action point.',
      title: 'Act',
      type: 'cta',
    })

    expect(ideaIssues.some((issue) => issue.includes('requires at least 1 one-big-idea point'))).to.equal(true)
    expect(ctaIssues.some((issue) => issue.includes('requires at least 1 cta point'))).to.equal(true)
  })

  it('detects comparison side point limits', () => {
    const issues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      comparison: {
        left: {label: 'Left', points: ['A', 'B', 'C', 'D']},
        right: {label: 'Right', points: ['A', 'B', 'C', 'D']},
      },
      evidence: [],
      motion: 'card-stack',
      points: [],
      slideId: 'slide-001',
      title: 'Compare',
      type: 'comparison',
    })

    expect(issues.some((issue) => issue.includes('left_points limit 3'))).to.equal(true)
    expect(issues.some((issue) => issue.includes('right_points limit 3'))).to.equal(true)
  })

  it('detects code and quote limits', () => {
    const codeIssues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      code: {language: 'ts', text: Array.from({length: 13}, (_, index) => `line ${index}`).join('\n')},
      evidence: [],
      motion: 'blur-rise',
      points: [],
      slideId: 'slide-code',
      title: 'Code',
      type: 'code',
    })
    const quoteIssues = validateSlideAgainstTemplateManifest({
      blockIds: [],
      evidence: [],
      motion: 'soft-scale',
      points: [],
      quote: {text: 'A'.repeat(97)},
      slideId: 'slide-quote',
      title: 'Quote',
      type: 'quote',
    })

    expect(codeIssues.some((issue) => issue.includes('code line limit 12'))).to.equal(true)
    expect(quoteIssues.some((issue) => issue.includes('quote limit 96'))).to.equal(true)
  })
})

describe('maxPointsForDeckTemplate', () => {
  it('returns correct limits for known types', () => {
    expect(maxPointsForDeckTemplate('hero')).to.equal(2)
    expect(maxPointsForDeckTemplate('three-points')).to.equal(3)
    expect(maxPointsForDeckTemplate('process')).to.equal(7)
    expect(maxPointsForDeckTemplate('timeline')).to.equal(5)
    expect(maxPointsForDeckTemplate('chart')).to.equal(4)
    expect(maxPointsForDeckTemplate('summary')).to.equal(4)
    expect(maxPointsForDeckTemplate('cta')).to.equal(1)
    expect(maxPointsForDeckTemplate('comparison')).to.equal(6)
    expect(maxPointsForDeckTemplate('image')).to.equal(0)
    expect(maxPointsForDeckTemplate('grid-cards')).to.equal(0)
  })
})

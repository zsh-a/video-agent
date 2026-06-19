import {expect} from '#test/expect'

import {defineSlideTemplateModule, type SlideTemplateModule} from '../../../packages/renderer-deck/src/deck/templates/define-template.js'
import {maxPointsForDeckTemplate, validateSlideAgainstTemplateManifest} from '../../../packages/renderer-deck/src/deck/templates/manifest.js'
import {resolveMotionStepsForTemplate, resolveSlideTemplate, slideTemplateModules, slideTemplateMotionSteps, slideTemplateRegistry} from '../../../packages/renderer-deck/src/deck/templates/registry.js'

describe('slideTemplateModules', () => {
  it('contains all 13 template types', () => {
    const types = slideTemplateModules.map((m) => m.template.type)

    expect(types).to.have.length(13)
    expect(types).to.include.members([
      'hero', 'section', 'one-big-idea', 'three-points', 'comparison',
      'process', 'timeline', 'quote', 'stat', 'chart', 'code', 'summary', 'cta',
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
})

describe('resolveSlideTemplate', () => {
  it('resolves each known type to its correct template', () => {
    for (const module of slideTemplateModules) {
      const resolved = resolveSlideTemplate(module.template.type)

      expect(resolved.type).to.equal(module.template.type)
    }
  })

  it('falls back to three-points for unknown type', () => {
    const resolved = resolveSlideTemplate('unknown-type' as Parameters<typeof resolveSlideTemplate>[0])

    expect(resolved.type).to.equal('three-points')
  })
})

describe('slideTemplateRegistry', () => {
  it('is a Map with all 13 types', () => {
    expect(slideTemplateRegistry.size).to.equal(13)
  })

  it('contains the same templates as slideTemplateModules', () => {
    for (const module of slideTemplateModules) {
      expect(slideTemplateRegistry.has(module.template.type)).to.equal(true)
    }
  })
})

describe('slideTemplateMotionSteps', () => {
  it('is a Map with all 13 types', () => {
    expect(slideTemplateMotionSteps.size).to.equal(13)
  })

  it('resolveMotionStepsForTemplate returns steps for all known types', () => {
    const types = ['hero', 'section', 'one-big-idea', 'three-points', 'comparison', 'process', 'timeline', 'quote', 'stat', 'chart', 'code', 'summary', 'cta'] as const

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

    expect(issues.some((issue) => issue.includes('point character limit 28'))).to.equal(true)
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
    expect(maxPointsForDeckTemplate('process')).to.equal(5)
    expect(maxPointsForDeckTemplate('timeline')).to.equal(5)
    expect(maxPointsForDeckTemplate('chart')).to.equal(4)
    expect(maxPointsForDeckTemplate('summary')).to.equal(4)
    expect(maxPointsForDeckTemplate('cta')).to.equal(1)
    expect(maxPointsForDeckTemplate('comparison')).to.equal(6)
  })
})

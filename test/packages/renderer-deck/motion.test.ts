import {expect} from '#test/expect'

import type {DeckMotionPreset, TimedDeck} from '@video-agent/ir'

import {clamp, compileDeckMotionPlan, motionPresetState, titlePresetFor} from '../../../packages/renderer-deck/src/deck/motion/index.js'
import type {ResolveMotionSteps} from '../../../packages/renderer-deck/src/deck/motion/index.js'
import type {TemplateMotionStep} from '../../../packages/renderer-deck/src/deck/templates/define-template.js'
import {resolveMotionStepsForTemplate} from '../../../packages/renderer-deck/src/deck/templates/registry.js'

function makeTimedDeck(slides: Array<{slideId: string; type: string; motion?: DeckMotionPreset; points?: string[]; title?: string; transitionOut?: TimedDeck['deck']['slides'][number]['transitionOut']}>, timings: Array<{slideId: string; start: number; end: number}>): TimedDeck {
  return {
    deck: {
      format: 'landscape_1920x1080',
      inputMode: 'script-generated',
      language: 'zh-CN',
      slides: slides.map((s, index) => ({
        blockIds: [],
        evidence: [],
        motion: s.motion ?? 'progressive-reveal',
        points: s.points ?? [],
        slideId: s.slideId,
        title: s.title ?? s.slideId,
        ...(index === slides.length - 1 ? {} : {transitionOut: s.transitionOut ?? {duration: 0.55, type: 'crossfade' as const}}),
        type: s.type as TimedDeck['deck']['slides'][number]['type'],
        visual: {assetRefs: [], kind: 'text' as const},
      })),
      theme: 'elegant-dark',
      title: 'Test Deck',
      version: 1,
    },
    timings,
    version: 1,
  }
}

describe('compileDeckMotionPlan', () => {
  it('returns a valid motion plan with duration, slides, and timeline', () => {
    const timedDeck = makeTimedDeck(
      [{slideId: 'slide-001', type: 'hero', points: ['A', 'B']}],
      [{slideId: 'slide-001', start: 0, end: 10}],
    )
    const plan = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)

    expect(plan.version).to.equal(1)
    expect(plan.duration).to.be.greaterThan(0)
    expect(plan.slides).to.have.length(1)
    expect(plan.slides[0].slideId).to.equal('slide-001')
    expect(plan.slides[0].start).to.equal(0)
    expect(plan.slides[0].end).to.equal(10)
    expect(plan.timeline.tracks.length).to.be.greaterThan(0)
    expect(plan.timeline.scenes).to.have.length(1)
  })

  it('generates tracks for each slide type using template motion steps', () => {
    const timedDeck = makeTimedDeck(
      [
        {slideId: 's1', type: 'hero', points: ['A']},
        {slideId: 's2', type: 'section'},
        {slideId: 's3', type: 'three-points', points: ['A', 'B', 'C']},
        {slideId: 's4', type: 'cta', points: ['Go']},
      ],
      [
        {slideId: 's1', start: 0, end: 5},
        {slideId: 's2', start: 5, end: 8},
        {slideId: 's3', start: 8, end: 16},
        {slideId: 's4', start: 16, end: 20},
      ],
    )
    const plan = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)

    expect(plan.slides).to.have.length(4)
    expect(plan.timeline.scenes).to.have.length(4)
    expect(plan.timeline.tracks.length).to.be.greaterThan(4)
  })

  it('uses template-defined motionSteps when resolveMotionSteps is provided', () => {
    const customSteps: TemplateMotionStep[] = [
      {selector: '.custom-title', preset: 'fade-in', at: () => 0.5, duration: () => 1},
      {selector: '.custom-body', preset: 'slide-up', at: () => 1.5, duration: (): number => 0.8},
    ]
    const resolver: ResolveMotionSteps = () => customSteps
    const timedDeck = makeTimedDeck(
      [{slideId: 'slide-001', type: 'hero', points: ['A']}],
      [{slideId: 'slide-001', start: 0, end: 10}],
    )
    const plan = compileDeckMotionPlan(timedDeck, resolver)

    expect(plan.timeline.tracks.length).to.be.greaterThan(0)
    const selectors = plan.timeline.tracks.map((t) => t.target.value)

    expect(selectors.some((s) => s.includes('custom-title'))).to.equal(true)
    expect(selectors.some((s) => s.includes('custom-body'))).to.equal(true)
  })

  it('throws when a template has no registered motionSteps', () => {
    const resolver: ResolveMotionSteps = () => undefined
    const timedDeck = makeTimedDeck(
      [{slideId: 'slide-001', type: 'hero', points: ['A']}],
      [{slideId: 'slide-001', start: 0, end: 10}],
    )

    expect(() => compileDeckMotionPlan(timedDeck, resolver)).to.throw('No motionSteps registered')
  })

  it('throws when a slide has no timing entry instead of deriving timing by index', () => {
    const timedDeck = makeTimedDeck(
      [
        {slideId: 'slide-001', type: 'hero', points: ['A']},
        {slideId: 'slide-002', type: 'three-points', points: ['B']},
      ],
      [{slideId: 'slide-001', start: 0, end: 10}],
    )

    expect(() => compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)).to.throw('missing timing for slide "slide-002"')
  })

  it('resolves template motion steps for all 13 slide types', () => {
    const types = ['hero', 'section', 'one-big-idea', 'three-points', 'comparison', 'process', 'timeline', 'quote', 'stat', 'chart', 'code', 'summary', 'cta']

    for (const type of types) {
      const steps = resolveMotionStepsForTemplate(type as Parameters<typeof resolveMotionStepsForTemplate>[0])

      expect(Array.isArray(steps)).to.equal(true)
      expect(steps!.length).to.be.greaterThan(0)
    }
  })

  it('includes a human-readable motion summary', () => {
    const timedDeck = makeTimedDeck(
      [{slideId: 'slide-001', type: 'hero', motion: 'cinematic-rise', points: ['A']}],
      [{slideId: 'slide-001', start: 0, end: 10}],
    )
    const plan = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)

    expect(plan.summary.trackCount).to.equal(plan.timeline.tracks.length)
    expect(plan.summary.lines.some((line) => line.includes('slide-001'))).to.equal(true)
  })
})

describe('motionPresetState', () => {
  it('returns correct properties for fade-in', () => {
    const state = motionPresetState('fade-in')

    expect(state.easing).to.equal('easeOutCubic')
    expect(state.properties).to.have.length(1)
    expect(state.properties[0].property).to.equal('opacity')
    expect(state.properties[0].from).to.equal(0)
    expect(state.properties[0].to).to.equal(1)
  })

  it('returns correct properties for blur-rise', () => {
    const state = motionPresetState('blur-rise')

    expect(state.easing).to.equal('easeOutCubic')
    expect(state.properties).to.have.length(3)
    expect(state.properties.map((p) => p.property)).to.include.members(['blur', 'opacity', 'translateY'])
  })

  it('returns correct properties for stagger-up', () => {
    const state = motionPresetState('stagger-up')

    expect(state.easing).to.equal('easeOutCubic')
    expect(state.properties).to.have.length(2)
  })

  it('returns correct properties for cinematic-rise', () => {
    const state = motionPresetState('cinematic-rise')

    expect(state.easing).to.equal('easeOutExpo')
    expect(state.properties).to.have.length(3)
  })

  it('rejects unknown motion presets instead of falling back to cinematic-rise', () => {
    expect(() => motionPresetState('unknown-preset' as DeckMotionPreset)).to.throw('Unknown deck motion preset')
  })

  const allPresets: DeckMotionPreset[] = [
    'fade-in', 'slide-up', 'soft-scale', 'blur-rise', 'stagger-up',
    'progressive-reveal', 'card-stack', 'line-draw', 'number-count',
    'spotlight', 'wipe', 'zoom-focus', 'cinematic-rise', 'rotate',
    'spin', 'spring', 'bounce', 'typewriter', 'parallax',
  ]

  for (const preset of allPresets) {
    it(`returns valid state for preset "${preset}"`, () => {
      const state = motionPresetState(preset)

      expect(typeof state.easing).to.equal('string')
      expect(state.properties.length).to.be.greaterThan(0)

      for (const prop of state.properties) {
        expect(typeof prop.from).to.equal('number')
        expect(typeof prop.to).to.equal('number')
      }
    })
  }
})

describe('titlePresetFor', () => {
  it('maps stagger-up to blur-rise', () => {
    expect(titlePresetFor('stagger-up')).to.equal('blur-rise')
  })

  it('maps progressive-reveal to blur-rise', () => {
    expect(titlePresetFor('progressive-reveal')).to.equal('blur-rise')
  })

  it('maps card-stack to blur-rise', () => {
    expect(titlePresetFor('card-stack')).to.equal('blur-rise')
  })

  it('maps number-count to slide-up', () => {
    expect(titlePresetFor('number-count')).to.equal('slide-up')
  })

  it('maps line-draw to slide-up', () => {
    expect(titlePresetFor('line-draw')).to.equal('slide-up')
  })

  it('maps spotlight to slide-up', () => {
    expect(titlePresetFor('spotlight')).to.equal('slide-up')
  })

  it('passes through other presets unchanged', () => {
    expect(titlePresetFor('fade-in')).to.equal('fade-in')
    expect(titlePresetFor('blur-rise')).to.equal('blur-rise')
    expect(titlePresetFor('soft-scale')).to.equal('soft-scale')
    expect(titlePresetFor('wipe')).to.equal('wipe')
  })
})

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).to.equal(5)
  })

  it('returns min when value is below range', () => {
    expect(clamp(-1, 0, 10)).to.equal(0)
  })

  it('returns max when value is above range', () => {
    expect(clamp(15, 0, 10)).to.equal(10)
  })
})

describe('blur-free mode', () => {
  it('maps blur-rise to slide-up when blurFree is true', () => {
    const state = motionPresetState('blur-rise', {blurFree: true})

    expect(state.easing).to.equal('easeOutCubic')
    expect(state.properties.map((p) => p.property)).to.not.include('blur')
    expect(state.properties.map((p) => p.property)).to.include.members(['opacity', 'translateY'])
  })

  it('maps progressive-reveal to stagger-up when blurFree is true', () => {
    const state = motionPresetState('progressive-reveal', {blurFree: true})

    expect(state.properties.map((p) => p.property)).to.not.include('blur')
  })

  it('maps zoom-focus to soft-scale when blurFree is true', () => {
    const state = motionPresetState('zoom-focus', {blurFree: true})

    expect(state.properties.map((p) => p.property)).to.not.include('blur')
  })

  it('does not affect presets without blur when blurFree is true', () => {
    const normal = motionPresetState('fade-in')
    const blurFree = motionPresetState('fade-in', {blurFree: true})

    expect(normal.properties.length).to.equal(blurFree.properties.length)
  })

  it('produces no blur tracks with blurFree for a deck using blur presets', () => {
    const timedDeck = makeTimedDeck(
      [{slideId: 'slide-001', type: 'hero', motion: 'progressive-reveal', points: ['A']}],
      [{slideId: 'slide-001', start: 0, end: 20}],
    )
    const normal = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)
    const blurFree = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate, {blurFree: true})
    const normalBlurTracks = normal.timeline.tracks.filter((t) => t.property === 'blur')
    const blurFreeBlurTracks = blurFree.timeline.tracks.filter((t) => t.property === 'blur')

    expect(normalBlurTracks.length).to.be.greaterThan(0)
    expect(blurFreeBlurTracks.length).to.equal(0)
  })
})

describe('transitions', () => {
  it('generates transitions for adjacent slides', () => {
    const timedDeck = makeTimedDeck(
      [
        {slideId: 's1', type: 'hero', points: ['A'], transitionOut: {duration: 0.4, type: 'slide-up'}},
        {slideId: 's2', type: 'three-points', points: ['A', 'B'], transitionOut: {duration: 0.7, type: 'fade'}},
        {slideId: 's3', type: 'cta', points: ['Go']},
      ],
      [
        {slideId: 's1', start: 0, end: 5},
        {slideId: 's2', start: 5, end: 15},
        {slideId: 's3', start: 15, end: 20},
      ],
    )
    const plan = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)

    expect(plan.transitions).to.have.length(2)
    expect(plan.transitions[0].from).to.equal('s1')
    expect(plan.transitions[0].to).to.equal('s2')
    expect(plan.transitions[1].from).to.equal('s2')
    expect(plan.transitions[1].to).to.equal('s3')
    expect(plan.transitions.map((transition) => transition.type)).to.deep.equal(['slide-up', 'fade'])
    expect(plan.transitions.map((transition) => transition.duration)).to.deep.equal([0.4, 0.7])
  })

  it('uses LLM-authored transition type instead of deriving it from slide templates', () => {
    const timedDeck = makeTimedDeck(
      [
        {slideId: 's1', type: 'hero', points: ['A'], transitionOut: {duration: 0.33, type: 'fade'}},
        {slideId: 's2', type: 'three-points', points: ['A']},
      ],
      [
        {slideId: 's1', start: 0, end: 5},
        {slideId: 's2', start: 5, end: 15},
      ],
    )
    const plan = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)

    expect(plan.transitions[0].type).to.equal('fade')
    expect(plan.transitions[0].duration).to.equal(0.33)
  })

  it('rejects missing LLM-authored transitionOut instead of using template-type fallback', () => {
    const timedDeck = makeTimedDeck(
      [
        {slideId: 's1', type: 'three-points', points: ['A'], transitionOut: undefined},
        {slideId: 's2', type: 'cta', points: ['Go']},
      ],
      [
        {slideId: 's1', start: 0, end: 10},
        {slideId: 's2', start: 10, end: 15},
      ],
    )
    delete timedDeck.deck.slides[0]?.transitionOut

    expect(() => compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)).to.throw('no template-type transition fallback is allowed')
  })

  it('returns empty transitions for single-slide deck', () => {
    const timedDeck = makeTimedDeck(
      [{slideId: 's1', type: 'hero', points: ['A']}],
      [{slideId: 's1', start: 0, end: 10}],
    )
    const plan = compileDeckMotionPlan(timedDeck, resolveMotionStepsForTemplate)

    expect(plan.transitions).to.have.length(0)
  })
})

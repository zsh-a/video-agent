import type {Deck, Slide, SlideTiming} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {renderToStaticMarkup} from 'react-dom/server'

import {SafeArea, SlideFrame, Stage, classNames} from '../layout/primitives.js'
import {SlideBody} from './slide-body.js'

export interface RenderDeckStageOptions {
  captureSlideId?: string
  timings: SlideTiming[]
}

interface SlideRenderItem {
  index: number
  slide: Slide
  timing?: SlideTiming
}

export function renderDeckStage(deck: Deck, options: RenderDeckStageOptions): string {
  const timingBySlide = new Map(options.timings.map((timing) => [timing.slideId, timing]))
  const slides = deck.slides
    .map((slide, index): SlideRenderItem => ({index, slide, timing: timingBySlide.get(slide.slideId)}))
    .filter((item) => options.captureSlideId === undefined || item.slide.slideId === options.captureSlideId)

  return renderToStaticMarkup(<DeckStage slides={slides} />)
}

function DeckStage({slides}: {slides: SlideRenderItem[]}): ReactNode {
  return (
    <Stage>
      {slides.map((item) => <DeckSlide item={item} key={item.slide.slideId} />)}
    </Stage>
  )
}

function DeckSlide({item}: {item: SlideRenderItem}): ReactNode {
  const {index, slide, timing} = item
  const start = timing?.start ?? 0
  const end = timing?.end ?? start + (slide.duration ?? 1)
  const className = classNames(
    `slide--${slide.type}`,
    slideDensityClass(slide),
    `slide--points-${Math.min(slide.points.length, 4)}`,
    'absolute inset-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden opacity-0',
  )

  return (
    <SlideFrame
      ariaLabel={slide.title}
      className={className}
      end={round(end)}
      slideId={slide.slideId}
      start={round(start)}
      template={slide.type}
    >
      <div className="slide__chrome relative z-[2] flex items-center justify-between border-b border-deck-line-soft pb-[22px] text-deck-caption font-bold leading-none text-deck-muted">
        <span className="text-deck-accent">{String(index + 1).padStart(2, '0')}</span>
        <span>{formatSlideType(slide.type)}</span>
      </div>
      <SafeArea className="slide__content relative z-[1] grid min-h-0 content-center gap-[34px] pt-[34px]" dataSafeCheck>
        <SlideBody slide={slide} />
      </SafeArea>
    </SlideFrame>
  )
}

function formatSlideType(type: Slide['type']): string {
  return type.replaceAll('-', ' ')
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

function slideDensityClass(slide: Slide): string {
  const textLength = [
    slide.title,
    slide.subtitle ?? '',
    ...slide.points,
    slide.code?.text ?? '',
    slide.comparison?.left.label ?? '',
    ...(slide.comparison?.left.points ?? []),
    slide.comparison?.right.label ?? '',
    ...(slide.comparison?.right.points ?? []),
  ].join('').length

  if (textLength >= 180) {
    return 'slide--dense'
  }

  if (textLength <= 72) {
    return 'slide--quiet'
  }

  return ''
}

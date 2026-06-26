import type {DeckGridCard} from '@video-agent/ir'
import type {ReactNode} from 'react'

import {Card, classNames} from '../../layout/primitives.js'
import {titlePresetFor} from '../../motion/index.js'
import {slideTiming} from '../../motion/helpers.js'
import {TitleBlock} from '../../components/index.js'
import {defineSlideTemplate, defineSlideTemplateModule, type TemplateMotionStep} from '../define-template.js'
import {gridCardsManifest} from './manifest.js'
import {gridCardsStyles} from './styles.js'

const gridCardsMotionSteps: TemplateMotionStep[] = [
  {selector: '.slide__title', preset: (m) => titlePresetFor(m), at: (d) => d * slideTiming(d).enterAt, duration: (d) => slideTiming(d).titleDuration(d)},
  {selector: '.slide__subtitle', preset: 'fade-in', at: (d) => d * (slideTiming(d).enterAt + 0.08), duration: (d) => slideTiming(d).contentDuration(d)},
  {selector: '.grid-card', preset: 'card-stack', at: (d) => d * slideTiming(d).contentAt, duration: (d) => slideTiming(d).contentDuration(d), stagger: 0.12},
]

export const gridCardsTemplate = defineSlideTemplate({
  render: (slide) => {
    if (slide.gridCards === undefined) {
      throw new Error(`Deck grid-cards slide "${slide.slideId}" is missing grid cards data.`)
    }

    return (
      <>
        <TitleBlock slide={slide} />
        <GridCardsBody cards={slide.gridCards.cards} />
      </>
    )
  },
  type: 'grid-cards',
})

function GridCardsBody({cards}: {cards: DeckGridCard[]}): ReactNode {
  const gridClass = cards.length <= 2 ? 'grid-cards--2' : cards.length === 3 ? 'grid-cards--3' : 'grid-cards--4'

  return (
    <div className={classNames('grid-cards grid gap-[18px]', gridClass)}>
      {cards.map((card, index) => (
        <Card className="grid-card relative grid gap-[16px] overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface p-[28px] shadow-deck-card" key={`${card.label}-${index}`}>
          {card.icon === undefined ? null : (
            <span className="grid-card__icon text-[calc(var(--font-heading)*0.72)]" aria-hidden="true">{card.icon}</span>
          )}
          <h3 className="grid-card__label m-0 text-deck-body font-bold leading-[1.2] text-deck-fg">{card.label}</h3>
          {card.description === undefined ? null : (
            <p className="grid-card__desc m-0 text-deck-caption leading-deck-body text-deck-muted">{card.description}</p>
          )}
          <div className="grid-card__accent" aria-hidden="true" />
        </Card>
      ))}
    </div>
  )
}

export const gridCardsTemplateModule = defineSlideTemplateModule({
  manifest: gridCardsManifest,
  motionSteps: gridCardsMotionSteps,
  styles: gridCardsStyles,
  template: gridCardsTemplate,
})

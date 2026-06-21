import type {Slide} from '@video-agent/ir'

export function deckSlideText(slide: Slide): string {
  return [slide.title, slide.subtitle, ...deckSlideContentParts(slide)].filter((value): value is string => value !== undefined).join(' ').trim()
}

export function deckSlideContentParts(slide: Slide): string[] {
  return [
    ...slide.points,
    ...(slide.process === undefined ? [] : slide.process.steps.flatMap((step) => [
      step.label,
      ...(step.detail === undefined ? [] : [step.detail]),
    ])),
    ...(slide.chart === undefined ? [] : slide.chart.bars.flatMap((bar) => [
      bar.label,
      ...(bar.caption === undefined ? [] : [bar.caption]),
    ])),
    ...(slide.comparison === undefined ? [] : [
      slide.comparison.left.label,
      ...slide.comparison.left.points,
      slide.comparison.right.label,
      ...slide.comparison.right.points,
    ]),
    ...(slide.quote === undefined ? [] : [slide.quote.text, slide.quote.attribution].filter((value): value is string => value !== undefined)),
    ...(slide.stat === undefined ? [] : [slide.stat.value, slide.stat.label, slide.stat.caption].filter((value): value is string => value !== undefined)),
    ...(slide.code === undefined ? [] : [slide.code.language, slide.code.text]),
  ]
}

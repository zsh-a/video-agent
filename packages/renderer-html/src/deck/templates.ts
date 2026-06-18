import type {Deck, DeckCodeBlock, DeckComparison, DeckQuote, DeckStat, Slide, SlideTiming} from '@video-agent/ir'

export interface RenderDeckStageOptions {
  captureSlideId?: string
  timings: SlideTiming[]
}

export function renderDeckStage(deck: Deck, options: RenderDeckStageOptions): string {
  const timingBySlide = new Map(options.timings.map((timing) => [timing.slideId, timing]))
  const slides = deck.slides
    .map((slide, index) => ({index, slide}))
    .filter((item) => options.captureSlideId === undefined || item.slide.slideId === options.captureSlideId)
    .map(({index, slide}) => renderSlide(slide, index, timingBySlide.get(slide.slideId)))
    .join('\n')

  return `  <main class="stage" data-stage>
${slides}
  </main>`
}

function renderSlide(slide: Slide, index: number, timing: SlideTiming | undefined): string {
  const start = timing?.start ?? 0
  const end = timing?.end ?? start + (slide.duration ?? 1)
  const densityClass = slideDensityClass(slide)
  const pointCountClass = ` slide--points-${Math.min(slide.points.length, 4)}`

  return `    <section class="slide slide--${escapeHtml(slide.type)}${densityClass}${pointCountClass}" data-slide="${escapeHtml(slide.slideId)}" data-start="${round(start)}" data-end="${round(end)}" aria-label="${escapeHtml(slide.title)}">
      <div class="slide__chrome">
        <span>${String(index + 1).padStart(2, '0')}</span>
        <span>${escapeHtml(formatSlideType(slide.type))}</span>
      </div>
      <div class="slide__content" data-safe-check>
${renderSlideBody(slide)}
      </div>
    </section>`
}

function renderSlideBody(slide: Slide): string {
  if (slide.type === 'hero') {
    return `${renderHeader(slide)}
        ${renderPoints(slide.points, {className: 'hero__points', max: 2})}`
  }

  if (slide.type === 'section') {
    return `${renderHeader(slide)}
        ${renderDivider('section__rule')}`
  }

  if (slide.type === 'one-big-idea') {
    return `${renderHeader(slide)}
        ${renderBigIdea(slide)}`
  }

  if (slide.type === 'comparison') {
    const comparison = comparisonForSlide(slide)

    return `${renderHeader(slide)}
        ${comparison === undefined ? renderReadableFallback(slide) : renderComparison(comparison)}`
  }

  if (slide.type === 'process') {
    return `${renderHeader(slide)}
        ${renderProcess(slide.points)}`
  }

  if (slide.type === 'timeline') {
    return `${renderHeader(slide)}
        ${renderTimeline(slide.points)}`
  }

  if (slide.type === 'quote') {
    return `${renderHeader(slide)}
        ${renderQuote(quoteForSlide(slide))}`
  }

  if (slide.type === 'stat') {
    return `${renderHeader(slide)}
        ${renderStatSlide(slide)}`
  }

  if (slide.type === 'chart') {
    return `${renderHeader(slide)}
        ${renderChart(slide.points)}`
  }

  if (slide.type === 'code') {
    return `${renderHeader(slide)}
        ${renderCode(codeForSlide(slide))}`
  }

  if (slide.type === 'summary') {
    return `${renderHeader(slide)}
        ${renderPoints(slide.points, {className: 'summary__points', max: 4})}`
  }

  if (slide.type === 'cta') {
    return `${renderHeader(slide)}
        ${renderCta(slide)}`
  }

  return `${renderHeader(slide)}
        ${renderPoints(slide.points, {className: 'points', max: 3})}`
}

function renderHeader(slide: Slide): string {
  return `        <header class="slide__header">
          <h1 class="slide__title">${escapeHtml(slide.title)}</h1>
${slide.subtitle === undefined ? '' : `          <p class="slide__subtitle">${escapeHtml(slide.subtitle)}</p>`}
        </header>`
}

function renderPoints(points: string[], options: {className: string; max: number}): string {
  const items = points.slice(0, options.max)

  if (items.length === 0) {
    return ''
  }

  return `<div class="${options.className}">
${items.map((point, index) => `          <div class="point">
            <span class="point__index">${String(index + 1).padStart(2, '0')}</span>
            <p>${escapeHtml(point)}</p>
          </div>`).join('\n')}
        </div>`
}

function renderBigIdea(slide: Slide): string {
  const idea = slide.points[0] ?? slide.subtitle ?? slide.speakerNote ?? slide.title
  const support = slide.points.slice(1, 3)

  return `<div class="idea-card">
          <p class="idea-card__headline">${escapeHtml(idea)}</p>
${support.length === 0 ? '' : `          <div class="idea-card__support">
${support.map((point) => `            <span>${escapeHtml(point)}</span>`).join('\n')}
          </div>`}
        </div>`
}

function renderReadableFallback(slide: Slide): string {
  if (slide.points.length > 0) {
    return renderPoints(slide.points, {className: 'points', max: 4})
  }

  return renderBigIdea(slide)
}

function renderComparison(comparison: DeckComparison): string {
  return `<div class="comparison">
          ${renderComparisonSide(comparison.left, 'left')}
          ${renderComparisonSide(comparison.right, 'right')}
        </div>`
}

function renderComparisonSide(side: DeckComparison['left'], sideClass: string): string {
  return `<section class="comparison__side comparison__side--${sideClass}">
            <h2>${escapeHtml(side.label)}</h2>
            <ul>
${side.points.slice(0, 3).map((point) => `              <li>${escapeHtml(point)}</li>`).join('\n')}
            </ul>
          </section>`
}

function renderProcess(points: string[]): string {
  const items = points.slice(0, 7)
  const densityClass = items.length > 4 ? ' process-list--dense' : items.length >= 3 ? ' process-list--grid' : ''

  if (items.length === 0) {
    return ''
  }

  return `<ol class="process-list${densityClass}">
${items.map((point, index) => `          <li class="point">
            <span>${String(index + 1).padStart(2, '0')}</span>
            <p>${escapeHtml(point)}</p>
          </li>`).join('\n')}
        </ol>`
}

function renderTimeline(points: string[]): string {
  return `<div class="timeline">
          <div class="timeline__line"></div>
${points.slice(0, 5).map((point) => `          <div class="timeline__item point">
            <span></span>
            <p>${escapeHtml(point)}</p>
          </div>`).join('\n')}
        </div>`
}

function renderQuote(quote: DeckQuote): string {
  return `<figure class="quote-block">
          <blockquote>${escapeHtml(quote.text)}</blockquote>
${quote.attribution === undefined ? '' : `          <figcaption>${escapeHtml(quote.attribution)}</figcaption>`}
        </figure>`
}

function renderStat(stat: DeckStat): string {
  return `<div class="stat-block">
          <strong>${escapeHtml(stat.value)}</strong>
          <span>${escapeHtml(stat.label)}</span>
${stat.caption === undefined ? '' : `          <p>${escapeHtml(stat.caption)}</p>`}
        </div>`
}

function renderStatSlide(slide: Slide): string {
  if (slide.stat === undefined) {
    return renderReadableFallback(slide)
  }

  const stat = slide.stat
  const points = slide.points.slice(0, 4)

  if (points.length === 0) {
    return renderStat(stat)
  }

  return `<div class="stat-layout">
          ${renderStat(stat)}
          <div class="stat-points">
${points.map((point, index) => `            <div class="point">
              <span class="point__index">${String(index + 1).padStart(2, '0')}</span>
              <p>${escapeHtml(point)}</p>
            </div>`).join('\n')}
          </div>
        </div>`
}

function renderChart(points: string[]): string {
  const bars = (points.length === 0 ? ['核心指标', '执行成本', '质量风险'] : points).slice(0, 4)

  return `<div class="chart-bars">
${bars.map((point, index) => `          <div class="chart-bar point" style="--bar-value: ${55 + index * 12}%">
            <span>${escapeHtml(point)}</span>
            <i></i>
          </div>`).join('\n')}
        </div>`
}

function renderCode(code: DeckCodeBlock): string {
  const lines = code.text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  return `<div class="code-block" data-language="${escapeHtml(code.language)}">
          <div class="code-block__header">
            <span>Template</span>
            <span>${escapeHtml(code.language)}</span>
          </div>
          <div class="code-block__body">
${(lines.length === 0 ? [code.text] : lines).slice(0, 12).map((line, index) => `            <div class="code-line">
              <span class="code-line__index">${String(index + 1).padStart(2, '0')}</span>
              <code>${escapeHtml(normalizeCodeLine(line))}</code>
            </div>`).join('\n')}
          </div>
        </div>`
}

function renderCta(slide: Slide): string {
  const label = slide.points[0] ?? slide.subtitle ?? 'Next step'

  return `<div class="cta-block">
          <p>${escapeHtml(label)}</p>
        </div>`
}

function renderDivider(className: string): string {
  return `<div class="${className}"></div>`
}

function comparisonForSlide(slide: Slide): DeckComparison | undefined {
  if (
    slide.comparison !== undefined &&
    slide.comparison.left.points.length > 0 &&
    slide.comparison.right.points.length > 0
  ) {
    return slide.comparison
  }

  return undefined
}

function quoteForSlide(slide: Slide): DeckQuote {
  return slide.quote ?? {
    text: slide.points[0] ?? slide.speakerNote ?? slide.title,
  }
}

function codeForSlide(slide: Slide): DeckCodeBlock {
  return slide.code ?? {
    language: 'text',
    text: slide.points.join('\n') || slide.title,
  }
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
    return ' slide--dense'
  }

  if (textLength <= 72) {
    return ' slide--quiet'
  }

  return ''
}

function normalizeCodeLine(value: string): string {
  return value.replace(/^#+\s*/, '')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

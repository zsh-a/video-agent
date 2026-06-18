import type {CSSProperties, ReactNode} from 'react'

export interface PrimitiveProps {
  children?: ReactNode
  className?: string
}

export interface CardProps extends PrimitiveProps {
  'data-language'?: string
}

export interface SlideFrameProps extends PrimitiveProps {
  ariaLabel: string
  end: number
  slideId: string
  start: number
  template: string
}

export function Stage({children, className}: PrimitiveProps): ReactNode {
  return (
    <main className={classNames('stage', className)} data-stage>
      {children}
    </main>
  )
}

export function SlideFrame({
  ariaLabel,
  children,
  className,
  end,
  slideId,
  start,
  template,
}: SlideFrameProps): ReactNode {
  return (
    <section
      aria-label={ariaLabel}
      className={classNames('slide', className)}
      data-end={end}
      data-slide={slideId}
      data-start={start}
      data-template={template}
    >
      {children}
    </section>
  )
}

export function SafeArea({
  children,
  className,
  dataSafeCheck = false,
}: PrimitiveProps & {dataSafeCheck?: boolean}): ReactNode {
  return (
    <div className={classNames('safe-area', className)} data-safe-check={dataSafeCheck || undefined}>
      {children}
    </div>
  )
}

export function Grid({children, className}: PrimitiveProps): ReactNode {
  return <div className={classNames('grid-primitive', className)}>{children}</div>
}

export function Stack({children, className}: PrimitiveProps): ReactNode {
  return <div className={classNames('stack', className)}>{children}</div>
}

export function Split({children, className}: PrimitiveProps): ReactNode {
  return <div className={classNames('split', className)}>{children}</div>
}

export function Center({children, className}: PrimitiveProps): ReactNode {
  return <div className={classNames('center', className)}>{children}</div>
}

export function Card({children, className, ...props}: CardProps): ReactNode {
  return <div className={classNames('card', className)} {...props}>{children}</div>
}

export function Background({
  children,
  className,
  style,
}: PrimitiveProps & {style?: CSSProperties}): ReactNode {
  return (
    <div className={classNames('background', className)} style={style}>
      {children}
    </div>
  )
}

export function classNames(...items: Array<string | false | null | undefined>): string {
  return items.filter((item): item is string => item !== undefined && item !== null && item !== false && item.length > 0).join(' ')
}

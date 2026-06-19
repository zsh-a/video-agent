import type {ReactNode} from 'react'

export function ImageCard({alt, caption, src}: {alt: string; caption?: string; src: string}): ReactNode {
  return (
    <figure className="image-card card m-0 overflow-hidden rounded-deck-card border border-deck-line bg-deck-surface shadow-deck-card">
      <img alt={alt} className="block h-full w-full object-cover" src={src} />
      {caption === undefined ? null : <figcaption className="p-[18px_22px] text-deck-caption text-deck-muted">{caption}</figcaption>}
    </figure>
  )
}

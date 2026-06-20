import type {RenderSummary, VisualSample} from '../types'
import {projectFileUrl} from '../utils'
import {Panel} from './ui'

export function RenderResultPanel({projectId, render}: {projectId?: string; render?: RenderSummary}) {
  const url = projectId !== undefined && render?.rendered === true && render.output !== undefined ? projectFileUrl(projectId, render.output) : undefined

  return (
    <Panel title="Render Result" summary={url === undefined ? 'No rendered output.' : render?.output}>
      {url !== undefined ? (
        <>
          <div className="mb-3 flex gap-2">
            <a className="btn" href={url} rel="noreferrer" target="_blank">Open video</a>
            <a className="btn" download={render?.output?.split('/').pop() ?? 'render.mp4'} href={url}>Download</a>
          </div>
          <video className="aspect-video w-full rounded-md border border-line bg-black" controls preload="metadata" src={url} />
        </>
      ) : null}
    </Panel>
  )
}

export function VisualSamplesPanel({samples}: {samples: VisualSample[]}) {
  return (
    <Panel title="Keyframes">
      {samples.length === 0 ? <p className="text-sm text-muted">No keyframes</p> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {samples.map((sample) => (
            <figure className={`rounded-md border ${sample.ok ? 'border-line' : 'border-amber-300'} bg-white p-2`} key={`${sample.timestamp}-${sample.path ?? sample.relativePath ?? ''}`}>
              {sample.exists === true && sample.contentBase64 !== undefined
                ? <img alt={`Keyframe at ${sample.timestamp}s`} className="aspect-video w-full rounded bg-black object-contain" src={`data:image/jpeg;base64,${sample.contentBase64}`} />
                : <div className="grid aspect-video place-items-center rounded bg-amber-50 p-3 text-center text-sm text-amber-800">{sample.error ?? 'Keyframe unavailable'}</div>}
              <figcaption className="mt-2 text-xs text-muted">{sample.timestamp}s {sample.relativePath ?? sample.path ?? ''}{sample.size === undefined ? '' : ` · ${sample.size} bytes`}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </Panel>
  )
}

export function DeckReviewPanel({onPreview, projectId, render}: {onPreview: (name: string) => void; projectId?: string; render?: RenderSummary}) {
  const available = projectId !== undefined && render?.reviewAvailable === true

  return (
    <Panel title="Deck Review" summary={available ? `Review available: ${render?.reviewHtml ?? ''} | ${render?.reviewReport ?? ''}` : 'No deck review.'}>
      {available ? (
        <div className="flex gap-2">
          {render?.reviewHtml !== undefined ? <a className="btn" href={projectFileUrl(projectId, render.reviewHtml)} rel="noreferrer" target="_blank">Open review</a> : null}
          {render?.reviewReport !== undefined ? <button className="btn" type="button" onClick={() => onPreview(render.reviewReport?.replace(/^artifacts\//u, '') ?? '')}>Preview report</button> : null}
        </div>
      ) : null}
    </Panel>
  )
}

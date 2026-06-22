import type {ProjectVisualSample} from '@video-agent/runtime'

export function formatVisualSample(sample: ProjectVisualSample): string {
  const status = sample.exists && sample.ok ? 'ok' : 'missing'
  const path = sample.relativePath ?? sample.path ?? '-'
  const size = sample.size ?? sample.reportSize ?? 0
  const error = sample.error === undefined ? '' : `\t${sample.error}`

  return `${sample.timestamp}s\t${status}\t${path}\t${size}${error}`
}

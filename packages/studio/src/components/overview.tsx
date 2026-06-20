import type {DashboardData} from '../types'

export function OverviewGrid({data}: {data: DashboardData}) {
  const status = data.projectStatus
  const render = status?.summary.render
  const traceCount = data.providerReport?.llmTraces?.length ?? 0

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
      <MetricCard className="xl:col-span-2" label="Status" value={status?.job.status ?? 'none'} detail={status === undefined ? 'No project selected.' : `${status.job.pipeline} | ${status.job.stages.length} stages | ${status.summary.events.count} events`} />
      <MetricCard label="Quality" value={status === undefined ? 'none' : `${status.summary.quality.issues} issues`} detail={status === undefined ? 'No quality report.' : `${status.summary.quality.errors} errors, ${status.summary.quality.warnings} warnings`} />
      <MetricCard label="Render" value={render?.rendered === true ? 'rendered' : 'none'} detail={render?.renderer ?? render?.output ?? 'No rendered output.'} />
      <MetricCard label="Artifacts" value={String(data.artifacts.length)} detail={`${data.artifacts.length} artifacts available`} />
      <MetricCard label="LLM Traces" value={String(traceCount)} detail={`${traceCount} traces, ${(data.providerReport?.llmTraces ?? []).filter((trace) => trace.status === 'failed').length} failed`} />
    </div>
  )
}

function MetricCard(props: {className?: string; detail: string; label: string; value: string}) {
  return (
    <article className={`panel ${props.className ?? ''}`}>
      <h2 className="section-title">{props.label}</h2>
      <p className="mt-2 text-2xl font-semibold">{props.value}</p>
      <p className="mt-2 text-sm text-muted">{props.detail}</p>
    </article>
  )
}

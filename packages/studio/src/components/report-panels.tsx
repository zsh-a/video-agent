import type {ProjectEvent, ProviderReport} from '../types'
import {formatUsage} from '../utils'
import {Panel, Table} from './ui'

export function LlmTracePanel({report}: {report?: ProviderReport}) {
  const traces = report?.llmTraces ?? []

  return (
    <Panel title="LLM Traces" summary={`${traces.length} traces, ${traces.filter((trace) => trace.status === 'failed').length} failed, ${formatUsage(report?.summary?.llm?.usage)}`}>
      <Table columns={['Status', 'Operation', 'Provider', 'Model', 'Usage', 'Latency', 'Request']}>
        {traces.slice(0, 30).map((trace) => (
          <tr key={trace.requestId}>
            <td>{trace.status}</td>
            <td>{trace.operation}</td>
            <td>{trace.provider ?? 'unknown'}</td>
            <td>{trace.model ?? 'unknown'}</td>
            <td>{formatUsage(trace.usage)}</td>
            <td>{trace.durationMs}ms</td>
            <td>{trace.requestId}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

export function RecentEventsPanel({events}: {events: ProjectEvent[]}) {
  return (
    <Panel title="Recent Events">
      <Table columns={['Time', 'Kind', 'Detail']}>
        {events.map((event, index) => <tr key={`${event.time}-${index}`}><td>{event.time}</td><td>{event.kind}</td><td>{String(event.event.type ?? event.event.operation ?? '')}</td></tr>)}
      </Table>
    </Panel>
  )
}

import type {ProviderEnvironment, RuntimeConfig} from '../types'
import {summarizeProviderEnvironment} from '../utils'
import {Panel, Table} from './ui'

export function ProviderPanel({report}: {report?: ProviderEnvironment}) {
  const summary = report?.summary ?? summarizeProviderEnvironment(report)
  return (
    <Panel title="Providers" summary={summary === undefined ? 'Loading providers.' : `${summary.configured}/${summary.total} env configured, ${summary.missingRequired.length} required missing`}>
      <Table columns={['Role', 'Provider', 'Required Env']}>
        {(report?.providers ?? []).map((provider) => (
          <tr key={`${provider.role}-${provider.provider}`}>
            <td>{provider.role}</td>
            <td>{provider.provider}</td>
            <td>{provider.requirements.filter((requirement) => requirement.required).map((requirement) => `${requirement.env}=${requirement.configured ? 'set' : 'missing'}`).join(', ') || 'none'}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

export function ConfigPanel({config}: {config?: RuntimeConfig}) {
  const rows = config === undefined ? [] : [
    ['providers.asr', config.providers.asr],
    ['providers.vlm', config.providers.vlm],
    ['providers.tts', config.providers.tts],
    ['persistence.jobStore', config.persistence.jobStore],
    ['pipeline.maxStageRetries', config.pipeline.maxStageRetries],
    ['pipeline.retryBackoffMs', config.pipeline.retryBackoffMs],
  ]

  return (
    <Panel title="Runtime Config" summary={config === undefined ? 'Loading config.' : `job store ${config.persistence.jobStore} | retries ${config.pipeline.maxStageRetries}`}>
      <Table columns={['Key', 'Value']}>
        {rows.map(([key, value]) => <tr key={key}><td>{key}</td><td>{String(value)}</td></tr>)}
      </Table>
    </Panel>
  )
}

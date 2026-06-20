import type {AgentStatus, ArtifactSummary, GuidedAction, StageSummary} from '../types'
import {Panel, Table} from './ui'

export function GuidedActionsPanel({actions, onCopy}: {actions: GuidedAction[]; onCopy: (command: string) => void}) {
  return (
    <Panel title="Guided Actions">
      <Table columns={['Action', 'Category', 'Description', 'Command', '']}>
        {actions.map((action) => (
          <tr key={`${action.label}-${action.command}`}>
            <td>{action.label}</td>
            <td>{action.category}</td>
            <td>{action.description}</td>
            <td><code>{action.command}</code></td>
            <td><button className="btn" type="button" onClick={() => onCopy(action.command)}>Copy</button></td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

export function PipelinePanel({stages}: {stages: StageSummary[]}) {
  return (
    <Panel title="Pipeline">
      <Table columns={['Stage', 'Status', 'Step', 'Progress']}>
        {stages.map((stage) => (
          <tr key={stage.name}>
            <td>{stage.name}</td>
            <td>{stage.status}</td>
            <td>{stage.step ?? stage.message ?? ''}</td>
            <td>{formatStageProgress(stage)}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

export function AgentPanel({agent}: {agent?: AgentStatus}) {
  const run = agent?.currentRun
  const steps = run?.steps ?? []

  return (
    <Panel title="Agent" summary={run === undefined ? 'No agent run recorded.' : `${run.status} · ${steps.length} step${steps.length === 1 ? '' : 's'}`}>
      <Table columns={['Step', 'Stage', 'Status', 'Progress']}>
        {steps.map((step, index) => (
          <tr key={`${step.name}-${step.startedAt}-${index}`}>
            <td>{step.name}</td>
            <td>{step.stage ?? ''}</td>
            <td>{step.status}</td>
            <td>{formatStageProgress(step)}</td>
          </tr>
        ))}
      </Table>
    </Panel>
  )
}

export function ArtifactsPanel({artifacts, onPreview, preview}: {artifacts: ArtifactSummary[]; onPreview: (name: string) => void; preview: string}) {
  return (
    <Panel title="Artifacts">
      <Table columns={['Name', 'Kind', 'Size', '']}>
        {artifacts.map((artifact) => (
          <tr key={artifact.name}>
            <td>{artifact.name}</td>
            <td>{artifact.kind}</td>
            <td>{artifact.size}</td>
            <td><button className="btn" type="button" onClick={() => onPreview(artifact.name)}>Preview</button></td>
          </tr>
        ))}
      </Table>
      <pre className="mt-3 max-h-72 overflow-auto rounded-md border border-line bg-code p-3 font-mono text-xs whitespace-pre-wrap">{preview}</pre>
    </Panel>
  )
}

function formatStageProgress(progress: {current?: number; percent?: number; total?: number; unit?: string}): string {
  if (progress.percent !== undefined) {
    return `${Math.round(progress.percent)}%`
  }

  if (progress.current !== undefined && progress.total !== undefined) {
    return `${progress.current}/${progress.total}${progress.unit === undefined ? '' : ` ${progress.unit}`}`
  }

  if (progress.current !== undefined) {
    return `${progress.current}${progress.unit === undefined ? '' : ` ${progress.unit}`}`
  }

  return ''
}

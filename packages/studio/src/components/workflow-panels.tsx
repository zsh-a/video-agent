import type {ArtifactSummary, GuidedAction, StageSummary} from '../types'
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
      <Table columns={['Stage', 'Status', 'Attempt']}>
        {stages.map((stage) => <tr key={stage.name}><td>{stage.name}</td><td>{stage.status}</td><td>{stage.attempt ?? ''}</td></tr>)}
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

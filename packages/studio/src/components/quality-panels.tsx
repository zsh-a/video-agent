import type {ArtifactIntegrity, QualityDetails, RenderOutput} from '../types'
import {artifactIntegrityRows, qualityCount, renderQualityRows} from '../utils'
import {IssueRow, IssueTable, Panel, Table} from './ui'

export function QualityPanel({integrity, quality, renderOutput}: {integrity?: ArtifactIntegrity; quality?: QualityDetails; renderOutput?: RenderOutput}) {
  const qualityRows = [
    ...(quality?.contentIssues ?? []).map((issue) => ({area: 'Content', issue})),
    ...(quality?.deckIssues ?? []).map((issue) => ({area: 'Deck', issue})),
    ...(quality?.qualityReport?.issues ?? []).map((issue) => ({area: 'Pipeline', issue})),
  ]
  const renderRows = renderQualityRows(renderOutput)
  const templateQuality = renderOutput?.templateQuality

  return (
    <div className="grid gap-3">
      <Panel title="Quality Issues" summary={quality === undefined ? 'No quality details.' : `project ${quality.summary.errors} errors, ${quality.summary.warnings} warnings | content ${quality.content.errors}/${quality.content.warnings} | deck ${quality.deck.errors}/${quality.deck.warnings}`}>
        <IssueTable rows={qualityRows} />
      </Panel>
      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="Template Quality" summary={templateQuality === undefined ? 'No template quality report.' : `${templateQuality.ok ? 'ok' : 'needs attention'} - ${templateQuality.errors} errors, ${templateQuality.warnings} warnings`}>
          <Table columns={['Severity', 'Code', 'Message']}>
            {(templateQuality?.issues ?? []).map((issue, index) => <IssueRow issue={issue} key={index} />)}
          </Table>
        </Panel>
        <Panel title="Render Quality" summary={renderOutput === undefined ? 'No render quality report.' : ['output ' + qualityCount(renderOutput.outputQuality), 'audio ' + qualityCount(renderOutput.audioQuality), 'subtitles ' + qualityCount(renderOutput.subtitleQuality), 'visual ' + qualityCount(renderOutput.visualQuality)].join(' | ')}>
          <IssueTable rows={renderRows} />
        </Panel>
        <Panel title="Artifact Integrity" summary={integrity === undefined ? 'No artifact integrity report.' : `${integrity.ok ? 'ok' : 'needs attention'} - ${integrity.summary?.errors ?? 0} errors, ${integrity.summary?.warnings ?? 0} warnings, ${integrity.summary?.checked ?? integrity.checked} checked`}>
          <Table columns={['Status', 'Name', 'Detail']}>
            {artifactIntegrityRows(integrity).map((row) => <tr key={`${row.status}-${row.name}-${row.detail}`}><td>{row.status}</td><td>{row.name}</td><td>{row.detail}</td></tr>)}
          </Table>
        </Panel>
      </div>
    </div>
  )
}

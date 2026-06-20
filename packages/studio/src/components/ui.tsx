import type {ReactNode} from 'react'

import type {ProjectSummary, QualityIssue} from '../types'

export function Panel({children, summary, title}: {children: ReactNode; summary?: string; title: string}) {
  return (
    <section className="panel">
      <h2 className="section-title">{title}</h2>
      {summary !== undefined ? <p className="mt-2 text-sm text-muted">{summary}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export function Table({children, columns}: {children: ReactNode; columns: string[]}) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children
  const isEmpty = Array.isArray(rows) && rows.length === 0

  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>{isEmpty ? <tr><td className="text-muted" colSpan={columns.length}>None</td></tr> : rows}</tbody>
      </table>
    </div>
  )
}

export function CheckField({checked, label, onChange}: {checked: boolean; label: string; onChange: (value: boolean) => void}) {
  return <label className="control-toggle"><input checked={checked} type="checkbox" onChange={(event) => onChange(event.currentTarget.checked)} />{label}</label>
}

export function NumberField({label, onChange, value}: {label: string; onChange: (value: number | undefined) => void; value?: number}) {
  return (
    <label className="form-label">{label}
      <input className="field" inputMode="decimal" value={value ?? ''} onChange={(event) => {
        const nextValue = event.currentTarget.value.trim()
        onChange(nextValue === '' ? undefined : Number(nextValue))
      }} />
    </label>
  )
}

export function StatusPill({loading, project}: {loading: boolean; project?: ProjectSummary}) {
  return <span className="rounded-full border border-line bg-white px-3 py-1 text-xs text-muted">{loading ? 'Loading' : project?.status ?? 'No project'}</span>
}

export function IssueTable({rows}: {rows: Array<{area: string; issue: QualityIssue}>}) {
  return (
    <Table columns={['Area', 'Severity', 'Code', 'Message']}>
      {rows.map(({area, issue}, index) => <IssueRow area={area} issue={issue} key={index} />)}
    </Table>
  )
}

export function IssueRow({area, issue}: {area?: string; issue: QualityIssue}) {
  return (
    <tr>
      {area !== undefined ? <td>{area}</td> : null}
      <td><span className={`severity severity-${issue.severity ?? 'warning'}`}>{issue.severity ?? 'warning'}</span></td>
      <td>{issue.code ?? ''}</td>
      <td>{issue.message ?? ''}</td>
    </tr>
  )
}

import {useState, type ReactNode} from 'react'

import type {AgentStep} from '../types'
import type {RunStageGroup, RunViewModel, RunViewStatus} from '../view-models/run-status'

export type DiagnosticTab = {
  content: ReactNode
  id: string
  label: string
}

export function RunConsole({diagnostics, view}: {diagnostics: DiagnosticTab[]; view: RunViewModel}) {
  return (
    <div className="grid gap-3">
      <RunStatusHeader view={view} />
      <div className="grid gap-3 xl:grid-cols-[0.8fr_1.2fr]">
        <CurrentWorkCard view={view} />
        <RunOutputSummary view={view} />
      </div>
      <AgentTimeline groups={view.stageGroups} />
      <DiagnosticsTabs tabs={diagnostics} />
    </div>
  )
}

function RunStatusHeader({view}: {view: RunViewModel}) {
  return (
    <section className="panel">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={view.status} />
            <span className="text-xs font-semibold uppercase text-muted">{view.pipeline}</span>
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-[0]">{view.projectId ?? 'No project selected'}</h2>
          <p className="mt-1 max-w-4xl text-sm text-muted">{view.headline}</p>
        </div>
        <ProgressBlock progress={view.progress} />
      </div>
    </section>
  )
}

function CurrentWorkCard({view}: {view: RunViewModel}) {
  const step = view.currentStep

  return (
    <section className="panel">
      <h2 className="section-title">Current Work</h2>
      {step === undefined ? (
        <p className="mt-3 text-sm text-muted">No active agent step.</p>
      ) : (
        <div className="mt-3 grid gap-3">
          <div>
            <p className="text-lg font-semibold">{step.message ?? step.name}</p>
            <p className="mt-1 text-sm text-muted">{step.stage ?? 'agent'} / {step.name}</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#dfe5df]">
            <div className={`h-full ${step.status === 'failed' ? 'bg-red-600' : 'bg-accent'}`} style={{width: `${boundedPercent(view.progress?.percent)}%`}} />
          </div>
          <p className="text-xs text-muted">{formatProgress(view.progress)}</p>
        </div>
      )}
    </section>
  )
}

function RunOutputSummary({view}: {view: RunViewModel}) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OutputMetric label="Render" tone={view.outputs.renderReady ? 'good' : 'neutral'} value={view.outputs.renderReady ? 'Ready' : 'Pending'} />
      <OutputMetric label="Quality" tone={view.outputs.qualityErrors > 0 ? 'bad' : view.outputs.qualityWarnings > 0 ? 'warn' : 'good'} value={`${view.outputs.qualityErrors} / ${view.outputs.qualityWarnings}`} detail="errors / warnings" />
      <OutputMetric label="Artifacts" value={String(view.outputs.artifacts)} />
      <OutputMetric label="LLM Calls" value={String(view.outputs.llmCalls)} />
    </section>
  )
}

function AgentTimeline({groups}: {groups: RunStageGroup[]}) {
  return (
    <section className="panel">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">Agent Timeline</h2>
        <span className="text-xs text-muted">{groups.length} stage{groups.length === 1 ? '' : 's'}</span>
      </div>
      <div className="mt-4 grid gap-2">
        {groups.length === 0 ? (
          <p className="text-sm text-muted">No run steps recorded.</p>
        ) : groups.map((group) => (
          <StageGroupRow group={group} key={group.name} />
        ))}
      </div>
    </section>
  )
}

function StageGroupRow({group}: {group: RunStageGroup}) {
  return (
    <div className="grid gap-2 rounded-md border border-line bg-white p-3 md:grid-cols-[180px_1fr]">
      <div className="flex items-center gap-2">
        <StatusDot status={group.status} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{group.name}</p>
          <p className="text-xs text-muted">{group.status}</p>
        </div>
      </div>
      <div className="grid gap-2">
        {group.steps.map((step, index) => (
          <StepRow index={index} key={`${step.name}-${step.startedAt}-${index}`} step={step} />
        ))}
      </div>
    </div>
  )
}

function StepRow({index, step}: {index: number; step: AgentStep}) {
  return (
    <div className="grid gap-2 rounded border border-[#edf0ec] bg-code px-3 py-2 md:grid-cols-[28px_1fr_120px]">
      <span className="text-xs font-semibold text-muted">{index + 1}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{step.message ?? step.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{step.name}</p>
      </div>
      <p className="text-xs text-muted md:text-right">{formatStepMeta(step)}</p>
    </div>
  )
}

function DiagnosticsTabs({tabs}: {tabs: DiagnosticTab[]}) {
  const [selected, setSelected] = useState(tabs[0]?.id ?? '')
  const activeTab = tabs.find((tab) => tab.id === selected) ?? tabs[0]

  if (activeTab === undefined) {
    return null
  }

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap gap-2 border-b border-line">
        {tabs.map((tab) => (
          <button className={`px-3 py-2 text-sm font-semibold ${tab.id === activeTab.id ? 'border-b-2 border-accent text-ink' : 'text-muted'}`} key={tab.id} type="button" onClick={() => setSelected(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div>{activeTab.content}</div>
    </section>
  )
}

function OutputMetric({detail, label, tone = 'neutral', value}: {detail?: string; label: string; tone?: 'bad' | 'good' | 'neutral' | 'warn'; value: string}) {
  const toneClass = tone === 'good'
    ? 'text-emerald-700'
    : tone === 'bad'
      ? 'text-red-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : 'text-ink'

  return (
    <article className="panel">
      <h2 className="section-title">{label}</h2>
      <p className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</p>
      {detail === undefined ? null : <p className="mt-1 text-xs text-muted">{detail}</p>}
    </article>
  )
}

function ProgressBlock({progress}: {progress?: RunViewModel['progress']}) {
  return (
    <div className="min-w-[180px] rounded-md border border-line bg-white px-3 py-2">
      <p className="text-xs font-semibold uppercase text-muted">Progress</p>
      <p className="mt-1 text-xl font-semibold">{formatProgress(progress)}</p>
    </div>
  )
}

function StatusBadge({status}: {status: RunViewStatus}) {
  const className = status === 'completed'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : status === 'failed'
      ? 'border-red-200 bg-red-50 text-red-800'
      : status === 'running'
        ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
        : 'border-line bg-white text-muted'

  return <span className={`rounded-full border px-2 py-1 text-[11px] font-bold uppercase ${className}`}>{status}</span>
}

function StatusDot({status}: {status: RunStageGroup['status']}) {
  const className = status === 'completed'
    ? 'bg-emerald-600'
    : status === 'failed'
      ? 'bg-red-600'
      : status === 'running'
        ? 'bg-accent'
        : 'bg-[#b7c0b8]'

  return <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${className}`} />
}

function formatProgress(progress: RunViewModel['progress']): string {
  if (progress?.percent !== undefined) return `${Math.round(progress.percent)}%`
  if (progress?.current !== undefined && progress.total !== undefined) return `${progress.current}/${progress.total}${progress.unit === undefined ? '' : ` ${progress.unit}`}`
  if (progress?.current !== undefined) return `${progress.current}${progress.unit === undefined ? '' : ` ${progress.unit}`}`

  return 'None'
}

function formatStepMeta(step: AgentStep): string {
  if (step.percent !== undefined) return `${Math.round(step.percent)}%`
  if (step.current !== undefined && step.total !== undefined) return `${step.current}/${step.total}${step.unit === undefined ? '' : ` ${step.unit}`}`
  if (step.durationMs !== undefined) return `${Math.round(step.durationMs)} ms`

  return step.status
}

function boundedPercent(percent: number | undefined): number {
  if (percent === undefined) return 0

  return Math.max(0, Math.min(100, percent))
}

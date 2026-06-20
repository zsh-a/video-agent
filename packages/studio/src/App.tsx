import {useCallback, useEffect, useMemo, useState} from 'react'

import {api, jsonPost, loadProjectData, loadWorkspaceActions, watchProject} from './api'
import {OperationsPanel} from './components/operations-panel'
import {OverviewGrid} from './components/overview'
import {ProjectSidebar} from './components/project-sidebar'
import {ConfigPanel, ProviderPanel} from './components/provider-config'
import {QualityPanel} from './components/quality-panels'
import {RecentEventsPanel, LlmTracePanel} from './components/report-panels'
import {DeckReviewPanel, RenderResultPanel, VisualSamplesPanel} from './components/render-panels'
import {StatusPill} from './components/ui'
import {AgentPanel, ArtifactsPanel, GuidedActionsPanel, PipelinePanel} from './components/workflow-panels'
import type {ActionState, DashboardData, ExportOptions, ProjectSummary, ProviderEnvironment, RenderOptions, RuntimeConfig} from './types'
import {emptyData} from './types'
import {defaultRerunStage, formatUnknownError} from './utils'

export function App() {
  const [data, setData] = useState<DashboardData>(emptyData)
  const [projectId, setProjectId] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [actionState, setActionState] = useState<ActionState>({kind: 'idle', message: 'Select a project to run actions.'})
  const [operationsEnabled, setOperationsEnabled] = useState(false)
  const [renderOptions, setRenderOptions] = useState<RenderOptions>({audio: true, audioDucking: false, subtitles: true})
  const [exportOptions, setExportOptions] = useState<ExportOptions>({cleanOutput: false, requireQuality: true})
  const [rerunStage, setRerunStage] = useState('')
  const [artifactPreview, setArtifactPreview] = useState('Select an artifact to preview.')

  const load = useCallback(async (requestedProjectId?: string) => {
    setLoading(true)
    try {
      const [health, providerEnv, config, projectsResponse] = await Promise.all([
        api<{ok: boolean; workspaceDir: string}>('/health'),
        api<ProviderEnvironment>('/provider-env'),
        api<RuntimeConfig>('/config'),
        api<{projects: ProjectSummary[]}>('/projects'),
      ])
      const projects = projectsResponse.projects
      const selectedProjectId = requestedProjectId ?? projectId ?? projects[0]?.projectId
      const selectedData = selectedProjectId === undefined
        ? await loadWorkspaceActions()
        : await loadProjectData(selectedProjectId)

      setData({
        ...selectedData,
        config,
        health,
        projects,
        providerEnv,
      })
      setProjectId(selectedProjectId)
      if (selectedProjectId === undefined) {
        setActionState({kind: 'idle', message: 'Select a project to run actions.'})
      }
    } catch (error) {
      setActionState({kind: 'error', message: formatUnknownError(error)})
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (projectId === undefined) {
      return undefined
    }

    return watchProject(projectId, (snapshot) => {
      setData((current) => ({
        ...current,
        events: snapshot.events,
        projectStatus: snapshot.projectStatus,
      }))
    }, (error) => {
      setActionState({kind: 'error', message: `Watch failed: ${formatUnknownError(error)}`})
    })
  }, [projectId])

  useEffect(() => {
    const stages = data.projectStatus?.job.stages ?? []
    if (stages.length === 0) {
      setRerunStage('')
      return
    }
    if (stages.some((stage) => stage.name === rerunStage)) return
    setRerunStage(defaultRerunStage(stages))
  }, [data.projectStatus, rerunStage])

  const selectedProject = useMemo(() => data.projects.find((project) => project.projectId === projectId), [data.projects, projectId])
  const projectSelected = projectId !== undefined
  const controlledActionsLocked = !projectSelected || !operationsEnabled

  const selectProject = (nextProjectId: string) => {
    setProjectId(nextProjectId)
    setOperationsEnabled(false)
    setArtifactPreview('Select an artifact to preview.')
    void load(nextProjectId)
  }

  const refresh = () => void load(projectId)

  const runProjectAction = async (label: string, path: string, body: unknown, controlled: boolean) => {
    if (projectId === undefined) return
    if (controlled && !operationsEnabled) {
      setActionState({kind: 'error', message: `${label} blocked: enable project operations first.`})
      return
    }
    setActionState({kind: 'running', message: `${label} running...`})
    try {
      const result = await api(path, jsonPost(body))
      setActionState({kind: 'success', message: `${label} complete: ${JSON.stringify(result)}`})
      await load(projectId)
    } catch (error) {
      setActionState({kind: 'error', message: `${label} failed: ${formatUnknownError(error)}`})
    }
  }

  const runWorkspaceAction = async (label: string, path: string, body: unknown) => {
    setActionState({kind: 'running', message: `${label} running...`})
    try {
      const result = await api(path, jsonPost(body))
      setActionState({kind: 'success', message: `${label} complete: ${JSON.stringify(result)}`})
      await load(projectId)
    } catch (error) {
      setActionState({kind: 'error', message: `${label} failed: ${formatUnknownError(error)}`})
    }
  }

  const previewArtifact = async (name: string) => {
    if (projectId === undefined) return
    setArtifactPreview(`Loading ${name}...`)
    try {
      const artifact = await api<{content: unknown}>(`/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(name)}`)
      setArtifactPreview(typeof artifact.content === 'string' ? artifact.content : JSON.stringify(artifact.content, null, 2))
    } catch (error) {
      setArtifactPreview(formatUnknownError(error))
    }
  }

  const copyAction = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command)
      setActionState({kind: 'success', message: `Copied: ${command}`})
    } catch (error) {
      setActionState({kind: 'error', message: `Copy failed: ${formatUnknownError(error)}`})
    }
  }

  return (
    <div className="min-h-screen bg-studio-bg text-ink">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold tracking-[0]">video-agent studio</h1>
              <span className="rounded-full border border-line bg-amber-50 px-2 py-1 text-[11px] font-semibold uppercase text-amber-800">Review mode</span>
            </div>
            <p className="mt-1 text-xs text-muted">{data.health?.workspaceDir ?? 'Loading workspace'}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill loading={loading} project={selectedProject} />
            <button className="btn" type="button" onClick={refresh}>Refresh</button>
          </div>
        </div>
      </header>

      <main className="grid min-h-[calc(100vh-65px)] grid-cols-1 lg:grid-cols-[300px_1fr]">
        <ProjectSidebar projects={data.projects} selectedProjectId={projectId} onSelect={selectProject} />
        <section className="grid content-start gap-3 p-4">
          <OverviewGrid data={data} />
          <div className="grid gap-3 xl:grid-cols-2">
            <ProviderPanel report={data.providerEnv} />
            <ConfigPanel config={data.config} />
          </div>
          <OperationsPanel
            actionState={actionState}
            controlledActionsLocked={controlledActionsLocked}
            exportOptions={exportOptions}
            operationsEnabled={operationsEnabled}
            projectId={projectId}
            renderOptions={renderOptions}
            rerunStage={rerunStage}
            stages={data.projectStatus?.job.stages ?? []}
            onExport={() => void runProjectAction('Export', `/projects/${encodeURIComponent(projectId ?? '')}/export`, exportOptions, true)}
            onExportOptionsChange={setExportOptions}
            onOperationsEnabledChange={setOperationsEnabled}
            onProviderTest={() => void runWorkspaceAction('Provider test', '/provider-test', {role: 'all'})}
            onRender={() => void runProjectAction('Render', `/projects/${encodeURIComponent(projectId ?? '')}/render`, renderOptions, true)}
            onRenderOptionsChange={setRenderOptions}
            onRerun={() => void runProjectAction('Rerun', `/projects/${encodeURIComponent(projectId ?? '')}/rerun`, {fromStage: rerunStage || undefined}, true)}
            onRerunStageChange={setRerunStage}
            onWorker={() => void runWorkspaceAction('Worker dry-run', '/worker', {dryRun: true, orderBy: 'oldest', runningStaleAfterMs: 60000, status: 'active'})}
          />
          <GuidedActionsPanel actions={data.actions} onCopy={copyAction} />
          <div className="grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
            <PipelinePanel stages={data.projectStatus?.job.stages ?? []} />
            <AgentPanel agent={data.projectStatus?.agent} />
          </div>
          <ArtifactsPanel artifacts={data.artifacts} preview={artifactPreview} onPreview={previewArtifact} />
          <RenderResultPanel projectId={projectId} render={data.projectStatus?.summary.render} />
          <VisualSamplesPanel samples={data.visualSamples} />
          <QualityPanel quality={data.quality} renderOutput={data.renderOutput} integrity={data.integrity} />
          <LlmTracePanel report={data.providerReport} />
          <DeckReviewPanel projectId={projectId} render={data.projectStatus?.summary.render} onPreview={previewArtifact} />
          <RecentEventsPanel events={data.events} />
        </section>
      </main>
    </div>
  )
}

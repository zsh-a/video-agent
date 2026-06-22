import type {ActionState, ExportOptions, ProviderTestOptions, RenderOptions, StageSummary} from '../types'
import {CheckField, NumberField, Panel} from './ui'

export function OperationsPanel(props: {
  actionState: ActionState
  controlledActionsLocked: boolean
  exportOptions: ExportOptions
  operationsEnabled: boolean
  projectId?: string
  providerTestOptions: ProviderTestOptions
  renderOptions: RenderOptions
  rerunStage: string
  stages: StageSummary[]
  onExport: () => void
  onExportOptionsChange: (options: ExportOptions) => void
  onOperationsEnabledChange: (enabled: boolean) => void
  onProviderTest: () => void
  onProviderTestOptionsChange: (options: ProviderTestOptions) => void
  onRender: () => void
  onRenderOptionsChange: (options: RenderOptions) => void
  onRerun: () => void
  onRerunStageChange: (stage: string) => void
  onWorker: () => void
}) {
  const providerTestReady = isFilled(props.providerTestOptions.mediaPath) && isFilled(props.providerTestOptions.framePath) && isFilled(props.providerTestOptions.text)
  const lockMessage = props.projectId === undefined
    ? 'Select a project to enable project operations.'
    : props.operationsEnabled
      ? `Project operations enabled for ${props.projectId}.`
      : 'Rerun, render, and export are disabled.'

  return (
    <Panel title="Controlled Operations" summary="Studio opens in read-only review mode. Enable project operations before rerun, render, or export.">
      <div className="flex flex-wrap items-center gap-2">
        <label className="control-toggle">
          <input checked={props.operationsEnabled} type="checkbox" onChange={(event) => props.onOperationsEnabledChange(event.currentTarget.checked)} />
          Enable project operations
        </label>
        <button className="btn" disabled={props.controlledActionsLocked} type="button" onClick={props.onRender}>Render</button>
        <button className="btn" disabled={props.controlledActionsLocked} type="button" onClick={props.onExport}>Export</button>
        <select className="field max-w-[260px]" disabled={props.controlledActionsLocked || props.stages.length === 0} value={props.rerunStage} onChange={(event) => props.onRerunStageChange(event.currentTarget.value)}>
          {props.stages.map((stage) => <option key={stage.name} value={stage.name}>{stage.name} ({stage.status})</option>)}
        </select>
        <button className="btn" disabled={props.controlledActionsLocked} type="button" onClick={props.onRerun}>Rerun</button>
        <button className="btn" disabled={props.projectId === undefined} type="button" onClick={props.onWorker}>Worker dry-run</button>
        <button className="btn" disabled={!providerTestReady} type="button" onClick={props.onProviderTest}>Provider test</button>
      </div>
      <p className="mt-3 text-sm text-muted">{lockMessage}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <CheckField label="Subtitles" checked={props.renderOptions.subtitles} onChange={(subtitles) => props.onRenderOptionsChange({...props.renderOptions, subtitles})} />
        <CheckField label="Audio" checked={props.renderOptions.audio} onChange={(audio) => props.onRenderOptionsChange({...props.renderOptions, audio})} />
        <CheckField label="Ducking" checked={props.renderOptions.audioDucking} onChange={(audioDucking) => props.onRenderOptionsChange({...props.renderOptions, audioDucking})} />
        <NumberField label="Source volume" value={props.renderOptions.sourceVolume} onChange={(sourceVolume) => props.onRenderOptionsChange({...props.renderOptions, sourceVolume})} />
        <NumberField label="Voiceover volume" value={props.renderOptions.voiceoverVolume} onChange={(voiceoverVolume) => props.onRenderOptionsChange({...props.renderOptions, voiceoverVolume})} />
        <label className="form-label">Export format
          <select className="field" value={props.exportOptions.format} onChange={(event) => props.onExportOptionsChange({...props.exportOptions, format: event.currentTarget.value as 'bundle' | 'video'})}>
            <option value="video">video</option>
            <option value="bundle">bundle</option>
          </select>
        </label>
        <label className="form-label">Export output
          <input className="field" placeholder="./final.mp4" value={props.exportOptions.outputPath ?? ''} onChange={(event) => props.onExportOptionsChange({...props.exportOptions, outputPath: event.currentTarget.value.trim() === '' ? undefined : event.currentTarget.value})} />
        </label>
        <CheckField label="Require quality" checked={props.exportOptions.requireQuality} onChange={(requireQuality) => props.onExportOptionsChange({...props.exportOptions, requireQuality})} />
        <CheckField label="Clean directory" checked={props.exportOptions.cleanOutput} onChange={(cleanOutput) => props.onExportOptionsChange({...props.exportOptions, cleanOutput})} />
        <label className="form-label">ASR media
          <input className="field" placeholder="./sample.wav" value={props.providerTestOptions.mediaPath ?? ''} onChange={(event) => props.onProviderTestOptionsChange({...props.providerTestOptions, mediaPath: readOptionalField(event.currentTarget.value)})} />
        </label>
        <label className="form-label">VLM frame
          <input className="field" placeholder="./frame.jpg" value={props.providerTestOptions.framePath ?? ''} onChange={(event) => props.onProviderTestOptionsChange({...props.providerTestOptions, framePath: readOptionalField(event.currentTarget.value)})} />
        </label>
        <label className="form-label">TTS text
          <input className="field" placeholder="Provider smoke test narration." value={props.providerTestOptions.text ?? ''} onChange={(event) => props.onProviderTestOptionsChange({...props.providerTestOptions, text: readOptionalField(event.currentTarget.value)})} />
        </label>
      </div>
      <p className={`mt-3 min-h-5 overflow-wrap-anywhere text-sm ${props.actionState.kind === 'error' ? 'text-red-700' : props.actionState.kind === 'success' ? 'text-emerald-700' : 'text-muted'}`}>{props.actionState.message}</p>
    </Panel>
  )
}

function isFilled(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

function readOptionalField(value: string): string | undefined {
  return value.trim() === '' ? undefined : value
}

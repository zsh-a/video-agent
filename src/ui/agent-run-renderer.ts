import type {PipelineEvent} from '@video-agent/core'
import type {ProviderCallRecord, ProviderCallStartRecord} from '@video-agent/runtime'
import type {Instance} from 'ink'

import {Box, Static, Text, render} from 'ink'
import {Fragment, createElement as h} from 'react'

import {
  type AgentRunProgressState,
  type AgentRunProviderState,
  type AgentRunStageState,
  type AgentRunTranscriptEntry,
  applyPipelineEvent,
  applyProviderCall,
  applyProviderCallStart,
  completeAgentRunProgressState,
  createAgentRunProgressState,
  failAgentRunProgressState,
  formatDuration,
  getCurrentStage,
} from './agent-run-state.js'

export interface CreateAgentRunProgressRendererOptions {
  output?: NodeJS.WriteStream
}

export interface AgentRunProgressRenderer {
  complete(summary: {artifacts: Record<string, unknown>; projectDir: string; projectId: string; status: string}): Promise<void>
  event(event: PipelineEvent): void
  fail(error: unknown): Promise<void>
  providerCall(call: ProviderCallRecord): void
  providerCallStart(call: ProviderCallStartRecord): void
}

interface AgentRunProgressAppProps {
  now: number
  state: AgentRunProgressState
}

const SPINNER_FRAMES = ['-', '\\', '|', '/']
const PROGRESS_BAR_WIDTH = 24

export function createAgentRunProgressRenderer(options: CreateAgentRunProgressRendererOptions = {}): AgentRunProgressRenderer {
  return new InkAgentRunProgressRenderer(options)
}

export function AgentRunProgressApp({now, state}: AgentRunProgressAppProps) {
  return h(Fragment, null,
    h(Transcript, {items: state.transcript}),
    h(Box, {flexDirection: 'column', gap: 1},
      h(Header, {now, state}),
      h(StageList, {state}),
      h(LivePanel, {now, state}),
    ),
  )
}

function Transcript({items}: {items: AgentRunTranscriptEntry[]}) {
  return h(Static, {
    items,
    children: (entry: unknown) => {
      const transcriptEntry = entry as AgentRunTranscriptEntry

      return h(Text, {
        color: transcriptColor(transcriptEntry.level),
        key: transcriptEntry.id,
      }, transcriptPrefix(transcriptEntry.level), ' ', transcriptEntry.text)
    },
  })
}

class InkAgentRunProgressRenderer implements AgentRunProgressRenderer {
  private readonly instance: Instance
  private readonly tickInterval: ReturnType<typeof setInterval>
  private finalized = false
  private state = createAgentRunProgressState()

  constructor(options: CreateAgentRunProgressRendererOptions) {
    this.instance = render(this.element(), {
      exitOnCtrlC: false,
      incrementalRendering: true,
      interactive: true,
      maxFps: 12,
      patchConsole: true,
      stdout: options.output ?? process.stderr,
    })
    this.tickInterval = setInterval(() => this.rerender(), 120)
    this.tickInterval.unref?.()
  }

  event(event: PipelineEvent): void {
    if (this.finalized) {
      return
    }

    this.state = applyPipelineEvent(this.state, event)
    this.rerender()
  }

  providerCallStart(call: ProviderCallStartRecord): void {
    if (this.finalized) {
      return
    }

    this.state = applyProviderCallStart(this.state, call)
    this.rerender()
  }

  providerCall(call: ProviderCallRecord): void {
    if (this.finalized) {
      return
    }

    this.state = applyProviderCall(this.state, call)
    this.rerender()
  }

  async complete(summary: {artifacts: Record<string, unknown>; projectDir: string; projectId: string; status: string}): Promise<void> {
    if (this.finalized) {
      return
    }

    this.state = completeAgentRunProgressState(this.state, {
      artifactCount: Object.keys(summary.artifacts).length,
      projectDir: summary.projectDir,
      projectId: summary.projectId,
      status: summary.status,
    })
    await this.stop()
  }

  async fail(error: unknown): Promise<void> {
    if (this.finalized) {
      return
    }

    this.state = failAgentRunProgressState(this.state, error)
    await this.stop()
  }

  private async stop(): Promise<void> {
    this.finalized = true
    clearInterval(this.tickInterval)
    this.rerender()
    await this.instance.waitUntilRenderFlush()
    this.instance.unmount()
    await this.instance.waitUntilExit()
    this.instance.cleanup()
  }

  private rerender(): void {
    this.instance.rerender(this.element())
  }

  private element() {
    return h(AgentRunProgressApp, {
      now: Date.now(),
      state: this.state,
    })
  }
}

function Header({now, state}: AgentRunProgressAppProps) {
  return h(Box, {flexDirection: 'column'},
    h(Box, {gap: 1},
      h(Text, {bold: true}, 'video-agent run'),
      h(Text, {dimColor: true}, 'project'),
      h(Text, null, state.projectId ?? 'pending'),
      h(Text, {dimColor: true}, 'elapsed'),
      h(Text, null, formatDuration(now - state.startedAt)),
    ),
    state.workspaceDir === undefined ? null : h(Text, {dimColor: true}, state.workspaceDir),
  )
}

function StageList({state}: {state: AgentRunProgressState}) {
  return h(Box, {flexDirection: 'column'},
    ...state.stages.map((stage) => h(StageRow, {
      key: stage.name,
      stage,
    })),
  )
}

function StageRow({stage}: {stage: AgentRunStageState}) {
  const detail = formatStageDetail(stage)

  return h(Box, {gap: 1},
    h(Text, {
      color: stageColor(stage.status),
    }, statusLabel(stage.status)),
    h(Text, {
      bold: stage.status === 'running' || stage.status === 'retrying',
      color: stage.status === 'pending' ? 'gray' : undefined,
    }, stage.name.padEnd(10)),
    detail === '' ? null : h(Text, {
      color: stage.status === 'pending' ? 'gray' : undefined,
      dimColor: stage.status === 'completed',
      wrap: 'truncate-end',
    }, detail),
  )
}

function LivePanel({now, state}: AgentRunProgressAppProps) {
  const stage = getCurrentStage(state)
  const runningProvider = state.providerCalls.find((call) => call.status === 'running')
  const recentProviders = state.providerCalls.slice(0, 3)

  return h(Box, {flexDirection: 'column'},
    stage === undefined ? null : h(CurrentStageLine, {now, stage, state}),
    runningProvider === undefined ? null : h(ProviderLine, {call: runningProvider, now, prefix: 'provider'}),
    runningProvider !== undefined || recentProviders.length === 0 ? null : h(ProviderLine, {call: recentProviders[0], now, prefix: 'provider'}),
    h(Box, {gap: 1},
      h(Text, {dimColor: true}, 'artifacts'),
      h(Text, null, String(state.artifactsWritten)),
      h(Text, {dimColor: true}, 'messages'),
      h(Text, null, String(state.lastMessages.length)),
    ),
    ...state.lastMessages.slice(0, 3).map((message, index) => h(Text, {
      dimColor: true,
      key: `${index}:${message}`,
      wrap: 'truncate-end',
    }, `  ${message}`)),
  )
}

function CurrentStageLine({now, stage, state}: {now: number; stage: AgentRunStageState; state: AgentRunProgressState}) {
  const frame = SPINNER_FRAMES[Math.floor((now - state.startedAt) / 120) % SPINNER_FRAMES.length]
  const label = stage.status === 'running' || stage.status === 'retrying' ? frame : statusLabel(stage.status)
  const progress = stage.percent === undefined ? '' : ` ${renderProgressBar(stage.percent)} ${formatPercent(stage.percent)}`
  const count = formatCount(stage)
  const name = stage.step === undefined ? stage.name : `${stage.name}.${stage.step}`

  return h(Box, {gap: 1},
    h(Text, {
      color: stageColor(stage.status),
    }, label),
    h(Text, {bold: stage.status !== 'pending'}, name),
    progress === '' ? null : h(Text, {color: 'cyan'}, progress),
    count === '' ? null : h(Text, {dimColor: true}, count),
    stage.message === undefined ? null : h(Text, {dimColor: true, wrap: 'truncate-end'}, stage.message),
  )
}

function ProviderLine({call, now, prefix}: {call: AgentRunProviderState; now: number; prefix: string}) {
  const duration = call.status === 'running' && call.startedAt !== undefined
    ? formatDuration(now - call.startedAt)
    : call.durationMs === undefined ? undefined : formatDuration(call.durationMs)

  return h(Box, {gap: 1},
    h(Text, {dimColor: true}, prefix),
    h(Text, {color: providerColor(call.status)}, call.status),
    h(Text, null, `${call.role}/${call.provider}`),
    h(Text, {wrap: 'truncate-end'}, call.operation),
    duration === undefined ? null : h(Text, {dimColor: true}, duration),
  )
}

function formatStageDetail(stage: AgentRunStageState): string {
  const parts = [
    stage.percent === undefined ? undefined : formatPercent(stage.percent),
    formatCount(stage),
    stage.step,
    stage.message,
  ].filter((part): part is string => part !== undefined && part !== '')

  return parts.join(' ')
}

function formatCount(stage: AgentRunStageState): string {
  if (stage.current === undefined || stage.total === undefined) {
    return ''
  }

  return `${stage.current}/${stage.total}${stage.unit === undefined ? '' : ` ${stage.unit}`}`
}

function renderProgressBar(percent: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * PROGRESS_BAR_WIDTH)

  return `[${'#'.repeat(filled)}${'-'.repeat(PROGRESS_BAR_WIDTH - filled)}]`
}

function formatPercent(percent: number): string {
  return `${Math.round(percent)}%`
}

function statusLabel(status: AgentRunStageState['status']): string {
  if (status === 'completed') {
    return 'done'
  }

  if (status === 'failed') {
    return 'fail'
  }

  if (status === 'retrying') {
    return 'try '
  }

  if (status === 'running') {
    return 'run '
  }

  return 'wait'
}

function stageColor(status: AgentRunStageState['status']): string | undefined {
  if (status === 'completed') {
    return 'green'
  }

  if (status === 'failed') {
    return 'red'
  }

  if (status === 'retrying') {
    return 'yellow'
  }

  if (status === 'running') {
    return 'cyan'
  }

  return 'gray'
}

function providerColor(status: AgentRunProviderState['status']): string {
  if (status === 'failed') {
    return 'red'
  }

  if (status === 'succeeded') {
    return 'green'
  }

  return 'cyan'
}

function transcriptColor(level: AgentRunTranscriptEntry['level']): string | undefined {
  if (level === 'error') {
    return 'red'
  }

  if (level === 'success') {
    return 'green'
  }

  if (level === 'warn') {
    return 'yellow'
  }

  return undefined
}

function transcriptPrefix(level: AgentRunTranscriptEntry['level']): string {
  if (level === 'error') {
    return 'fail'
  }

  if (level === 'success') {
    return 'done'
  }

  if (level === 'warn') {
    return 'warn'
  }

  return 'info'
}

import type {PipelineEvent, Stage} from '@video-agent/core'
import type {JobStore} from '@video-agent/db'
import type {ArtifactRef, MediaInfo, Narration, Storyboard, Timeline} from '@video-agent/ir'
import type {ProviderSet, Transcript, TTSSegment, VLMScene} from '@video-agent/providers'

import {createPlaceholderNarration, createPlaceholderStoryboard, createPlaceholderTimeline, runPipeline} from '@video-agent/core'
import {createPreview, extractAudio, extractFrames, probeMedia} from '@video-agent/media'
import {createProviders} from '@video-agent/providers'
import {checkNarrationTiming, checkTimelineBounds, checkTtsCoverage, type QualityIssue} from '@video-agent/quality'
import {access, appendFile, mkdir} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {refreshArtifactManifest} from './artifact-store.js'
import {verifyProjectArtifacts} from './artifacts.js'
import {readConfig} from './config.js'
import {createConfiguredJobStore} from './job-store.js'
import {createJsonlProviderCallRecorder, instrumentProviders} from './provider-calls.js'
import {createProjectWorkspace, type ProjectWorkspace} from './workspace.js'

export interface RunInitialPipelineOptions {
  fromStage?: InitialPipelineStage
  inputPath: string
  projectId?: string
  workspaceDir?: string
}

export type InitialPipelineStage = 'ingest' | 'plan' | 'quality' | 'script' | 'understand' | 'voiceover'

export interface RunInitialPipelineResult {
  artifacts: {
    frames?: string
    ingestReport: string
    mediaInfo: string
    narration: string
    pipelineEvents: string
    preview: string
    providerCalls: string
    qualityReport: string
    sceneAnalysis: string
    sourceAudio?: string
    storyboard: string
    timeline: string
    transcript: string
    ttsSegments: string
  }
  projectDir: string
  projectId: string
  status: 'completed' | 'failed'
}

interface InitialPipelineInput {
  inputPath: string
  providers: PipelineProviders
  workspace: ProjectWorkspace
}

interface IngestOutput extends InitialPipelineInput {
  artifacts: RunInitialPipelineResult['artifacts']
  mediaInfo: MediaInfo
}

interface UnderstandOutput extends IngestOutput {
  sceneAnalysis: VLMScene[]
  transcript: Transcript
}

interface PlanOutput extends UnderstandOutput {
  storyboard: Storyboard
  timeline: Timeline
}

interface ScriptOutput extends PlanOutput {
  narration: Narration
}

interface VoiceoverOutput extends ScriptOutput {
  ttsSegments: TTSSegment[]
}

interface QualityOutput extends VoiceoverOutput {
  issues: QualityIssue[]
}

interface PipelineProviders {
  asr: ProviderSet['asr']
  tts: ProviderSet['tts']
  vlm: ProviderSet['vlm']
}

type InitialStageInput = IngestOutput | InitialPipelineInput | PlanOutput | ScriptOutput | UnderstandOutput | VoiceoverOutput
type InitialStageOutput = IngestOutput | PlanOutput | QualityOutput | ScriptOutput | UnderstandOutput | VoiceoverOutput

const STAGES: readonly InitialPipelineStage[] = ['ingest', 'understand', 'plan', 'script', 'voiceover', 'quality']

const CHECKPOINT_ARTIFACTS_BY_STAGE: Record<InitialPipelineStage, readonly string[]> = {
  ingest: [],
  plan: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json'],
  quality: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json', 'storyboard.json', 'timeline.json', 'narration.json', 'tts-segments.json'],
  script: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json', 'storyboard.json', 'timeline.json'],
  understand: ['ingest-report.json', 'media-info.json'],
  voiceover: ['ingest-report.json', 'media-info.json', 'scene-analysis.json', 'transcript.json', 'storyboard.json', 'timeline.json', 'narration.json'],
}

export class PipelineCheckpointError extends Error {
  readonly changedArtifacts: string[]
  readonly fromStage: InitialPipelineStage
  readonly missingArtifacts: string[]
  readonly untrackedArtifacts: string[]

  constructor(fromStage: InitialPipelineStage, issues: {changedArtifacts?: string[]; missingArtifacts?: string[]; untrackedArtifacts?: string[]}) {
    const changedArtifacts = issues.changedArtifacts ?? []
    const missingArtifacts = issues.missingArtifacts ?? []
    const untrackedArtifacts = issues.untrackedArtifacts ?? []
    const issueMessages = [
      ...(missingArtifacts.length === 0 ? [] : [`missing: ${missingArtifacts.join(', ')}`]),
      ...(changedArtifacts.length === 0 ? [] : [`changed: ${changedArtifacts.join(', ')}`]),
      ...(untrackedArtifacts.length === 0 ? [] : [`untracked: ${untrackedArtifacts.join(', ')}`]),
    ]

    super(`Cannot resume from ${fromStage}; checkpoint artifact issue(s): ${issueMessages.join('; ')}.`)
    this.changedArtifacts = changedArtifacts
    this.fromStage = fromStage
    this.missingArtifacts = missingArtifacts
    this.untrackedArtifacts = untrackedArtifacts
    this.name = 'PipelineCheckpointError'
  }
}

export async function runInitialPipeline(options: RunInitialPipelineOptions): Promise<RunInitialPipelineResult> {
  const inputPath = resolve(options.inputPath)

  await access(inputPath)

  const workspace = await createProjectWorkspace({
    inputPath,
    projectId: options.projectId,
    workspaceDir: options.workspaceDir,
  })
  const pipelineEventsPath = workspace.store.resolve('pipeline-events.jsonl')
  const providerCallsPath = workspace.store.resolve('provider-calls.jsonl')
  const artifacts: RunInitialPipelineResult['artifacts'] = {
    ingestReport: workspace.store.resolve('ingest-report.json'),
    mediaInfo: workspace.store.resolve('media-info.json'),
    narration: workspace.store.resolve('narration.json'),
    pipelineEvents: pipelineEventsPath,
    preview: join(workspace.rendersDir, 'preview.mp4'),
    providerCalls: providerCallsPath,
    qualityReport: workspace.store.resolve('quality-report.json'),
    sceneAnalysis: workspace.store.resolve('scene-analysis.json'),
    storyboard: workspace.store.resolve('storyboard.json'),
    timeline: workspace.store.resolve('timeline.json'),
    transcript: workspace.store.resolve('transcript.json'),
    ttsSegments: workspace.store.resolve('tts-segments.json'),
  }
  const config = await readConfig(workspace.workspaceDir)
  const providers = instrumentProviders(createProviders(config), config.providers, createJsonlProviderCallRecorder(providerCallsPath))
  const ctx = {
    artifactsDir: workspace.artifactsDir,
    emit: async (event: PipelineEvent) => appendEvent(pipelineEventsPath, event),
    projectId: workspace.projectId,
    workspaceDir: workspace.workspaceDir,
  }
  const fromStage = options.fromStage ?? 'ingest'
  const stageIndex = resolveStageIndex(fromStage)
  const stages = STAGES.slice(stageIndex)
  const jobStore = createConfiguredJobStore({
    config,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    workspaceDir: workspace.workspaceDir,
  })

  await assertCheckpointArtifacts(workspace.projectId, workspace.workspaceDir, fromStage)
  await jobStore.initialize({
    inputPath,
    projectId: workspace.projectId,
    stages,
  })

  const output = await runPipeline<InitialStageInput, QualityOutput>(
    await hydratePipelineInput({
      artifacts,
      fromStage,
      inputPath,
      providers,
      workspace,
    }),
    createStageChain(fromStage, artifacts),
    {
      ...ctx,
      async emit(event: PipelineEvent) {
        await appendEvent(pipelineEventsPath, event)
        await updateJobStateFromEvent(jobStore, event)
      },
      retryPolicy: {
        backoffMs: config.pipeline.retryBackoffMs,
        maxRetries: config.pipeline.maxStageRetries,
      },
    },
  )
  const status = output.issues.some((issue) => issue.severity === 'error') ? 'failed' : 'completed'

  await jobStore.complete(status)
  await refreshArtifactManifest(workspace.artifactsDir)

  return {
    artifacts: output.artifacts,
    projectDir: workspace.projectDir,
    projectId: workspace.projectId,
    status,
  }
}

async function updateJobStateFromEvent(jobStore: JobStore, event: PipelineEvent): Promise<void> {
  if (event.stage === undefined) {
    return
  }

  if (event.type === 'stage:start') {
    await jobStore.updateStage(event.stage, 'running', undefined, event.attempt)
    return
  }

  if (event.type === 'stage:complete') {
    await jobStore.updateStage(event.stage, 'completed', undefined, event.attempt)
    return
  }

  if (event.type === 'stage:fail') {
    await jobStore.updateStage(event.stage, 'failed', event.message, event.attempt)
  }
}

function createStageChain(fromStage: InitialPipelineStage, artifacts: RunInitialPipelineResult['artifacts']): Stage<InitialStageInput, InitialStageOutput>[] {
  const stageIndex = resolveStageIndex(fromStage)

  return [
    createIngestStage(artifacts),
    createUnderstandStage(),
    createPlanStage(),
    createScriptStage(),
    createVoiceoverStage(),
    createQualityStage(),
  ].slice(stageIndex)
}

function resolveStageIndex(fromStage: InitialPipelineStage): number {
  const stageIndex = STAGES.indexOf(fromStage)

  if (stageIndex === -1) {
    throw new Error(`Unknown stage: ${fromStage}`)
  }

  return stageIndex
}

function createIngestStage(artifacts: RunInitialPipelineResult['artifacts']): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'ingest',
    async run(input) {
      const initial = input as InitialPipelineInput
      const mediaInfo = await probeMedia(initial.inputPath)
      const previewDuration = Math.min(mediaInfo.duration ?? 10, 10)
      const framePattern = join(initial.workspace.framesDir, 'frame_%05d.jpg')

      await mkdir(initial.workspace.framesDir, {recursive: true})
      await extractFrames(initial.inputPath, framePattern)
      await createPreview(initial.inputPath, artifacts.preview, previewDuration)

      const nextArtifacts = {
        ...artifacts,
        frames: framePattern,
      }

      if (mediaInfo.streams.some((stream) => stream.type === 'audio')) {
        nextArtifacts.sourceAudio = join(initial.workspace.audioDir, 'source.wav')
        await extractAudio(initial.inputPath, nextArtifacts.sourceAudio)
      }

      const ingestReport = {
        artifacts: nextArtifacts,
        completedAt: new Date().toISOString(),
        inputPath: initial.inputPath,
        stage: 'ingest',
        version: 1,
      }

      await initial.workspace.store.writeJson('media-info.json', mediaInfo)
      await initial.workspace.store.writeJson('ingest-report.json', ingestReport)

      return {
        ...initial,
        artifacts: nextArtifacts,
        mediaInfo,
      }
    },
  }
}

function createUnderstandStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'understand',
    async run(input) {
      const ingest = input as IngestOutput
      const transcript = await ingest.providers.asr.transcribe({
        path: ingest.artifacts.sourceAudio ?? ingest.inputPath,
      })
      const sceneAnalysis = await ingest.providers.vlm.analyzeScenes([
        {
          frames: ingest.artifacts.frames === undefined ? [] : [ingest.artifacts.frames],
          sceneId: 'scene-1',
          timeRange: [0, ingest.mediaInfo.duration ?? 0],
        },
      ])

      await ingest.workspace.store.writeJson('transcript.json', transcript)
      await ingest.workspace.store.writeJson('scene-analysis.json', sceneAnalysis)

      return {
        ...ingest,
        sceneAnalysis,
        transcript,
      }
    },
  }
}

function createPlanStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'plan',
    async run(input) {
      const understood = input as UnderstandOutput
      const storyboard = createPlaceholderStoryboard(understood.mediaInfo)
      const sceneAnalysis = understood.sceneAnalysis[0]
      const timeline = createPlaceholderTimeline(understood.mediaInfo)

      storyboard.scenes = storyboard.scenes.map((scene) => ({
        ...scene,
        evidence: [
          {
            ref: 'transcript.json',
            text: understood.transcript.text,
            type: 'asr',
          },
          ...(sceneAnalysis === undefined
            ? []
            : [
                {
                  ref: 'scene-analysis.json',
                  text: sceneAnalysis.description,
                  type: 'vlm' as const,
                },
              ]),
        ],
      }))

      await understood.workspace.store.writeJson('storyboard.json', storyboard)
      await understood.workspace.store.writeJson('timeline.json', timeline)

      return {
        ...understood,
        storyboard,
        timeline,
      }
    },
  }
}

function createScriptStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'script',
    async run(input) {
      const planned = input as PlanOutput
      const narration = createPlaceholderNarration(planned.storyboard)

      await planned.workspace.store.writeJson('narration.json', narration)

      return {
        ...planned,
        narration,
      }
    },
  }
}

function createVoiceoverStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'voiceover',
    async run(input) {
      const scripted = input as ScriptOutput
      const ttsSegments = await scripted.providers.tts.synthesize(scripted.narration.segments)

      await scripted.workspace.store.writeJson('tts-segments.json', ttsSegments)

      return {
        ...scripted,
        ttsSegments,
      }
    },
  }
}

function createQualityStage(): Stage<InitialStageInput, InitialStageOutput> {
  return {
    name: 'quality',
    async run(input) {
      const voiced = input as VoiceoverOutput
      const issues = [
        ...checkTimelineBounds(voiced.timeline),
        ...checkNarrationTiming(voiced.narration, voiced.timeline),
        ...checkTtsCoverage(voiced.narration, voiced.ttsSegments),
      ]
      const qualityReport = {
        checkedAt: new Date().toISOString(),
        issues,
        narrationSegments: voiced.narration.segments.length,
        summary: summarizeQualityIssues(issues),
        ttsSegments: voiced.ttsSegments.length,
        version: 1,
      }

      await voiced.workspace.store.writeJson('quality-report.json', qualityReport)

      return {
        ...voiced,
        issues,
      }
    },
  }
}

function summarizeQualityIssues(issues: QualityIssue[]): {errors: number; warnings: number} {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

interface HydratePipelineInputOptions {
  artifacts: RunInitialPipelineResult['artifacts']
  fromStage: InitialPipelineStage
  inputPath: string
  providers: PipelineProviders
  workspace: ProjectWorkspace
}

async function hydratePipelineInput(options: HydratePipelineInputOptions): Promise<InitialStageInput> {
  const {artifacts, fromStage, inputPath, providers, workspace} = options

  if (fromStage === 'ingest') {
    return {
      inputPath,
      providers,
      workspace,
    }
  }

  const ingestReport = await workspace.store.readJson<{artifacts?: Partial<RunInitialPipelineResult['artifacts']>}>('ingest-report.json')
  const ingest: IngestOutput = {
    artifacts: {
      ...artifacts,
      ...ingestReport.artifacts,
    },
    inputPath,
    mediaInfo: await workspace.store.readJson<MediaInfo>('media-info.json'),
    providers,
    workspace,
  }

  if (fromStage === 'understand') {
    return ingest
  }

  const understood: UnderstandOutput = {
    ...ingest,
    sceneAnalysis: await workspace.store.readJson<VLMScene[]>('scene-analysis.json'),
    transcript: await workspace.store.readJson<Transcript>('transcript.json'),
  }

  if (fromStage === 'plan') {
    return understood
  }

  const planned: PlanOutput = {
    ...understood,
    storyboard: await workspace.store.readJson<Storyboard>('storyboard.json'),
    timeline: await workspace.store.readJson<Timeline>('timeline.json'),
  }

  if (fromStage === 'script') {
    return planned
  }

  const scripted: ScriptOutput = {
    ...planned,
    narration: await workspace.store.readJson<Narration>('narration.json'),
  }

  if (fromStage === 'voiceover') {
    return scripted
  }

  return {
    ...scripted,
    ttsSegments: await workspace.store.readJson<TTSSegment[]>('tts-segments.json'),
  }
}

export async function assertCheckpointArtifacts(projectId: string, workspaceDir: string, fromStage: InitialPipelineStage): Promise<void> {
  const workspace = await createProjectWorkspace({
    projectId,
    workspaceDir,
  })
  const requiredArtifacts = CHECKPOINT_ARTIFACTS_BY_STAGE[fromStage]

  if (requiredArtifacts.length === 0) {
    return
  }

  const missing = (
    await Promise.all(
      requiredArtifacts.map(async (artifact) => {
        try {
          await access(workspace.store.resolve(artifact))
          return null
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return artifact
          }

          throw error
        }
      }),
    )
  ).filter((artifact): artifact is string => artifact !== null)

  const integrity = await verifyProjectArtifacts(workspace.projectId, workspace.workspaceDir)
  const required = new Set(requiredArtifacts)
  const changedArtifacts = integrity.changed.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const missingManifestArtifacts = integrity.missing.map((issue) => issue.name).filter((artifact) => required.has(artifact))
  const untrackedArtifacts = integrity.untracked.filter((artifact) => required.has(artifact))
  const missingArtifacts = [...new Set([...missing, ...missingManifestArtifacts])]

  if (missingArtifacts.length > 0 || changedArtifacts.length > 0 || untrackedArtifacts.length > 0) {
    throw new PipelineCheckpointError(fromStage, {
      changedArtifacts,
      missingArtifacts,
      untrackedArtifacts,
    })
  }
}

async function appendEvent(path: string, event: PipelineEvent): Promise<void> {
  const artifact = event.type === 'artifact' ? event.artifact : undefined

  await appendFile(path, `${JSON.stringify({...event, artifact: normalizeArtifact(artifact)})}\n`)
}

function normalizeArtifact(artifact: ArtifactRef | undefined): ArtifactRef | undefined {
  return artifact
}

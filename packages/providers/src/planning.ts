import type {LLMClient} from '@video-agent/llm'

import {createNarrationFromClipPlan, createStoryboardFromProviderInsights} from '@video-agent/core'
import {NarrationSchema, RecapScriptSchema, StoryboardSchema, type NarrativeBeat, type RecapScript, type RecapScriptSegment, type Storyboard, type StoryboardScene} from '@video-agent/ir'

import type {RecapScriptProviderInput, ScriptProvider, ScriptProviderInput, StoryboardProvider, StoryboardProviderInput} from './contracts.js'

export class DeterministicStoryboardProvider implements StoryboardProvider {
  async createStoryboard(input: StoryboardProviderInput) {
    const selectedMomentsStoryboard = createStoryboardFromSelectedMoments(input)

    if (selectedMomentsStoryboard !== undefined) {
      return StoryboardSchema.parse(selectedMomentsStoryboard)
    }

    return StoryboardSchema.parse(createStoryboardFromProviderInsights(input.mediaInfo, {
      sceneAnalysis: input.sceneAnalysis,
      transcript: input.transcript,
    }))
  }
}

export class DeterministicScriptProvider implements ScriptProvider {
  async createNarration(input: ScriptProviderInput) {
    const narration = createNarrationFromClipPlan(input.storyboard, input.clipPlan)

    return NarrationSchema.parse({
      ...narration,
      segments: narration.segments.map((segment, index) => ({
        ...segment,
        text: createExplainerNarrationText(segment.text, index),
      })),
    })
  }

  async createRecapScript(input: RecapScriptProviderInput) {
    return RecapScriptSchema.parse(createDeterministicRecapScript(input))
  }
}

export class LLMStoryboardProvider implements StoryboardProvider {
  constructor(private readonly llm: LLMClient) {}

  async createStoryboard(input: StoryboardProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            goal: 'Create concise video storyboard JSON. Return only data that matches the provided schema.',
            instructions: [
              'Create a StoryboardIR for a text-driven explainer video, similar to a slide-by-slide PPT walkthrough over the source footage.',
              'When longVideo.selectedMoments is present, create one storyboard scene for each selected moment unless two adjacent moments are duplicates.',
              'Do not collapse all selected moments into one full-length scene.',
              'Use scene IDs from sceneAnalysis or transcript-derived order.',
              'Keep sourceRange within media duration when present.',
              'Keep each scene duration equal to its sourceRange length.',
              'Preserve selected moment sourceRange values and evidence refs such as chunks/000/vlm.json when useful.',
              'Use evidence refs transcript.json and scene-analysis.json only when selected moment evidence is unavailable.',
              'Use visualStyle "slide_explainer" for scenes that primarily explain text or app concepts.',
              'Write concise scene narration that explains the key point; do not paste the raw transcript wholesale.',
            ],
            longVideo: summarizeLongVideoPlanning(input),
            mediaInfo: summarizeMediaInfo(input.mediaInfo),
            sceneAnalysis: input.sceneAnalysis,
            transcript: input.transcript,
          }),
          role: 'user',
        },
      ],
      schema: StoryboardSchema,
      temperature: 0.2,
    })

    return StoryboardSchema.parse(result.object)
  }
}

export class LLMScriptProvider implements ScriptProvider {
  constructor(private readonly llm: LLMClient) {}

  async createNarration(input: ScriptProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            clipPlan: input.clipPlan,
            goal: 'Create narration JSON for a video timeline. Return only data that matches the provided schema.',
            instructions: [
              'Create one narration segment per storyboard scene unless there is a strong reason to split.',
              'Preserve sceneId links.',
              'Keep segment start and duration aligned with clipPlan clips.',
              'When longVideo.selectedMoments is present, use the selected moment summaries and evidence as primary script context.',
              'Rewrite the source text into concise explainer narration, similar to speaker notes for PPT slides.',
              'Do not copy a long raw transcript wholesale into one narration segment.',
              'Keep each narration text focused on one key point and suitable for TTS.',
            ],
            longVideo: summarizeLongVideoPlanning(input),
            storyboard: input.storyboard,
          }),
          role: 'user',
        },
      ],
      schema: NarrationSchema,
      temperature: 0.2,
    })

    return NarrationSchema.parse(result.object)
  }

  async createRecapScript(input: RecapScriptProviderInput) {
    const result = await this.llm.generateObject({
      messages: [
        {
          content: JSON.stringify({
            goal: 'Write a Film Recap third-person narration script. Return only JSON matching RecapScriptSchema.',
            instructions: [
              'Create exactly one recap script segment for each storyIndex beat unless a beat is unusable; preserve chronological order.',
              'Every segment.targetBeatIds must contain the matching storyIndex beat id.',
              'Use ASR and VLM evidence to write scene-specific narration. Do not repeat generic phrases across segments.',
              'Do not paste raw dialogue wholesale. Rewrite into concise third-person recap commentary suitable for TTS.',
              'Make narrationText reflect the concrete event in that beat: who acts, what changes, and why it matters.',
              'Use visualGuidance to describe what footage should be selected for that segment.',
              'Keep suggestedDuration proportional to beat sourceRange and make totalEstimatedDuration close to targetDurationSeconds.',
              'Do not invent character names or plot events not supported by storyIndex, asrResult, or vlmAnalysis.',
              'Use the storyIndex.language for hook, narrationText, visualGuidance, and outro.',
            ],
            input: summarizeFilmRecapScriptInput(input),
          }),
          role: 'user',
        },
      ],
      schema: RecapScriptSchema,
      temperature: 0.35,
    })

    return RecapScriptSchema.parse(result.object)
  }
}

function createDeterministicRecapScript(input: RecapScriptProviderInput): RecapScript {
  const beats = input.storyIndex.beats
    .map((beat) => ({
      ...beat,
      sourceRange: normalizeSourceRange(beat.sourceRange, input.sourceManifest.duration),
    }))
    .filter((beat) => beat.sourceRange[1] > beat.sourceRange[0])
  const targetDuration = Math.max(0, Math.min(input.targetDurationSeconds ?? defaultRecapDuration(input.sourceManifest.duration), input.sourceManifest.duration))

  if (beats.length === 0) {
    throw new Error('Film Recap script writing requires at least one narrative beat.')
  }

  if (targetDuration <= 0) {
    throw new Error('Film Recap script writing requires a positive target duration.')
  }

  const selectedBeats = selectRecapBeatsForTarget(beats, targetDuration)
  const durations = allocateRecapDurations(selectedBeats, targetDuration)
  const segments = selectedBeats.map((beat, index): RecapScriptSegment => {
    const text = summarizeBeatForNarration(beat)

    return {
      emotionalTone: inferRecapTone(beat, index, beats.length),
      id: `recap-script-${String(index + 1).padStart(3, '0')}`,
      narrationText: `${createRecapLead(beat, index, beats.length, input.storyIndex.language)}${text}`,
      suggestedDuration: durations[index] ?? 0,
      targetBeatIds: [beat.id],
      visualGuidance: `Select footage from ${formatSourceRange(beat.sourceRange)} that supports: ${text}`,
    }
  })

  return {
    hook: beats[0]?.summary ?? 'The recap opens on the central conflict.',
    language: input.storyIndex.language,
    outro: beats.at(-1)?.summary ?? 'The recap ends with the final consequence.',
    segments,
    totalEstimatedDuration: roundSeconds(segments.reduce((total, segment) => total + segment.suggestedDuration, 0)),
    version: 1,
  }
}

function summarizeFilmRecapScriptInput(input: RecapScriptProviderInput): Record<string, unknown> {
  return {
    asrResult: {
      language: input.asrResult.language,
      segments: input.asrResult.segments.map((segment) => ({
        end: segment.end,
        id: segment.id,
        speaker: segment.speaker,
        start: segment.start,
        text: segment.text,
      })),
      timestampConfidence: input.asrResult.timestampConfidence,
    },
    sourceManifest: {
      duration: input.sourceManifest.duration,
      fps: input.sourceManifest.fps,
      height: input.sourceManifest.height,
      orientation: input.sourceManifest.orientation,
      sourceDuration: input.sourceManifest.duration,
      width: input.sourceManifest.width,
    },
    storyIndex: input.storyIndex,
    targetDurationSeconds: input.targetDurationSeconds,
    vlmAnalysis: {
      scenes: input.vlmAnalysis.scenes.map((scene) => ({
        actions: scene.actions,
        characters: scene.characters,
        emotions: scene.emotions,
        id: scene.id,
        plotClues: scene.plotClues,
        relationships: scene.relationships,
        sceneId: scene.sceneId,
        sourceRange: scene.sourceRange,
        summary: scene.summary,
      })),
    },
  }
}

function defaultRecapDuration(sourceDuration: number): number {
  if (sourceDuration <= 0) {
    return 0
  }

  return sourceDuration <= 90 ? sourceDuration : roundSeconds(Math.min(Math.max(sourceDuration * 0.6, 90), 300))
}

function allocateRecapDurations(beats: Array<Pick<NarrativeBeat, 'sourceRange'>>, targetDuration: number): number[] {
  const sourceDurations = beats.map((beat) => Math.max(0, beat.sourceRange[1] - beat.sourceRange[0]))
  const totalSourceDuration = sourceDurations.reduce((total, duration) => total + duration, 0)

  if (totalSourceDuration <= 0 || targetDuration <= 0) {
    return beats.map(() => 0)
  }

  const scale = Math.min(1, targetDuration / totalSourceDuration)

  return sourceDurations.map((duration) => roundSeconds(duration * scale))
}

function selectRecapBeatsForTarget<T extends NarrativeBeat>(beats: T[], targetDuration: number): T[] {
  if (beats.length === 0 || targetDuration / beats.length >= 0.3) {
    return beats
  }

  const count = Math.max(1, Math.floor(targetDuration / 0.3))

  if (count === 1) {
    return [beats[0] as T]
  }

  return beats
    .map((beat, index) => ({beat, index, score: scoreRecapBeat(beat, index, beats.length)}))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, count)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.beat)
}

function scoreRecapBeat(beat: NarrativeBeat, index: number, total: number): number {
  const typeScore: Record<NarrativeBeat['type'], number> = {
    climax: 90,
    conflict: 70,
    decision: 85,
    inciting_incident: 80,
    resolution: 75,
    reversal: 95,
    setup: 55,
    transition: 35,
  }

  return typeScore[beat.type] + Math.min(12, beat.evidence.length * 3) + (index === 0 || index === total - 1 ? 4 : 0)
}

function summarizeBeatForNarration(beat: NarrativeBeat): string {
  const summary = normalizeFallbackRecapText(beat.summary.replaceAll(/\s+/g, ' ').trim())

  return trimSentence(summary === '' ? `${beat.type} beat ${beat.id}.` : summary, 180)
}

function normalizeFallbackRecapText(text: string): string {
  return text
    .replace(/为推动组织长期健康发展[，,]?/gu, '')
    .replace(/人才结构优化/gu, '裁员')
    .trim()
}

function createRecapLead(beat: NarrativeBeat, index: number, total: number, language: string): string {
  const chinese = language.toLowerCase().startsWith('zh')

  if (chinese) {
    if (index === 0 || beat.type === 'setup') return '一开场，'
    if (beat.type === 'resolution' || index === total - 1) return '最后，'
    if (beat.type === 'climax' || beat.type === 'reversal') return '关键时刻，'
    return '随后，'
  }

  if (index === 0 || beat.type === 'setup') return 'At the start, '
  if (beat.type === 'resolution' || index === total - 1) return 'By the end, '
  if (beat.type === 'climax' || beat.type === 'reversal') return 'At the turning point, '
  return 'Then, '
}

function inferRecapTone(beat: NarrativeBeat, index: number, total: number): RecapScriptSegment['emotionalTone'] {
  if (beat.type === 'resolution' || index === total - 1) return 'resolution'
  if (beat.type === 'climax' || beat.type === 'reversal') return 'climax'
  if (beat.type === 'setup' || beat.type === 'inciting_incident' || index === 0) return 'setup'
  return 'tension'
}

function formatSourceRange(range: [number, number]): string {
  return `${roundSeconds(range[0])}-${roundSeconds(range[1])}s`
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

function trimSentence(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trim()}...`
}

function createStoryboardFromSelectedMoments(input: StoryboardProviderInput): Storyboard | undefined {
  const moments = input.longVideo?.selectedMoments?.moments ?? []

  if (moments.length === 0) {
    return undefined
  }

  let timelineStart = 0
  const sourceDuration = input.mediaInfo.duration
  const scenes = moments.map((moment, index): StoryboardScene => {
    const sourceRange = normalizeSourceRange(moment.sourceRange, sourceDuration)
    const duration = Math.max(sourceRange[1] - sourceRange[0], 0.001)
    const scene: StoryboardScene = {
      duration,
      evidence: moment.evidence,
      id: `scene-${index + 1}`,
      narration: moment.summary,
      sourceRange,
      start: timelineStart,
      visualStyle: 'slide_explainer',
    }

    timelineStart += duration

    return scene
  })

  return {
    language: input.longVideo?.globalOutline?.language ?? input.transcript.language ?? 'zh-CN',
    scenes,
    targetPlatform: 'generic',
    version: 1,
  }
}

function createExplainerNarrationText(value: string, index: number): string {
  const text = value.replaceAll(/\s+/g, ' ').trim()

  if (/^第\s*\d+\s*页[：:]/.test(text)) {
    return text
  }

  return `第 ${index + 1} 页：${text}`
}

function normalizeSourceRange(range: [number, number], sourceDuration: number | undefined): [number, number] {
  let start = Math.max(0, range[0])
  let end = Math.max(start, range[1])

  if (sourceDuration !== undefined && Number.isFinite(sourceDuration) && sourceDuration > 0) {
    start = Math.min(start, sourceDuration)
    end = Math.min(Math.max(end, start), sourceDuration)
  }

  if (end <= start) {
    end = sourceDuration !== undefined && Number.isFinite(sourceDuration) && sourceDuration > start
      ? Math.min(sourceDuration, start + 1)
      : start + 1
  }

  return [start, end]
}

function summarizeMediaInfo(mediaInfo: StoryboardProviderInput['mediaInfo']): Record<string, unknown> {
  return {
    duration: mediaInfo.duration,
    formatName: mediaInfo.formatName,
    inputPath: mediaInfo.inputPath,
    streams: mediaInfo.streams.map((stream) => ({
      duration: stream.duration,
      fps: stream.fps,
      height: stream.height,
      type: stream.type,
      width: stream.width,
    })),
  }
}

function summarizeLongVideoPlanning(input: {longVideo?: StoryboardProviderInput['longVideo']}): Record<string, unknown> | undefined {
  if (input.longVideo === undefined) {
    return undefined
  }

  return {
    chapters: input.longVideo.chapters,
    chunkCount: input.longVideo.chunkPlan?.chunks.length,
    chunkSummaries: input.longVideo.chunkSummaries,
    globalOutline: input.longVideo.globalOutline,
    selectedMoments: input.longVideo.selectedMoments,
  }
}

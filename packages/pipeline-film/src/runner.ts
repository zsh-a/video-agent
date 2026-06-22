import type {RunFilmRecapProjectOptions, RunFilmRecapProjectResult} from './recovery/runner.js'

import {FILM_STAGE_IDS} from './pipeline.js'
import {runFilmRecapProject} from './recovery/runner.js'

export type RunFilmRecapPipelineOptions = Omit<RunFilmRecapProjectOptions, 'fromStage'>

export interface RunFilmRecapPipelineResult extends Omit<RunFilmRecapProjectResult, 'audioMix' | 'clipPlan' | 'cut' | 'finalRender' | 'ingest' | 'outputNarration' | 'quality' | 'script' | 'storyIndex' | 'subtitle' | 'understanding' | 'voiceover'> {
  audioMix: NonNullable<RunFilmRecapProjectResult['audioMix']>
  clipPlan: NonNullable<RunFilmRecapProjectResult['clipPlan']>
  cut: NonNullable<RunFilmRecapProjectResult['cut']>
  finalRender: NonNullable<RunFilmRecapProjectResult['finalRender']>
  ingest: NonNullable<RunFilmRecapProjectResult['ingest']>
  outputNarration: NonNullable<RunFilmRecapProjectResult['outputNarration']>
  quality: NonNullable<RunFilmRecapProjectResult['quality']>
  script: NonNullable<RunFilmRecapProjectResult['script']>
  status: 'completed'
  storyIndex: NonNullable<RunFilmRecapProjectResult['storyIndex']>
  subtitle: NonNullable<RunFilmRecapProjectResult['subtitle']>
  understanding: NonNullable<RunFilmRecapProjectResult['understanding']>
  voiceover: NonNullable<RunFilmRecapProjectResult['voiceover']>
}

export async function runFilmRecapPipeline(options: RunFilmRecapPipelineOptions): Promise<RunFilmRecapPipelineResult> {
  const result = await runFilmRecapProject({
    ...options,
    fromStage: FILM_STAGE_IDS.ingest,
  })

  if (result.status !== 'completed') {
    throw new Error('Film Recap pipeline completed with quality errors.')
  }

  return requireFullPipelineResult(result)
}

function requireFullPipelineResult(result: RunFilmRecapProjectResult): RunFilmRecapPipelineResult {
  if (!isFullPipelineResult(result)) {
    throw new Error('Film Recap full pipeline did not produce every stage result.')
  }

  return result
}

function isFullPipelineResult(result: RunFilmRecapProjectResult): result is RunFilmRecapPipelineResult {
  return result.status === 'completed'
    && result.audioMix !== undefined
    && result.clipPlan !== undefined
    && result.cut !== undefined
    && result.finalRender !== undefined
    && result.ingest !== undefined
    && result.outputNarration !== undefined
    && result.quality !== undefined
    && result.script !== undefined
    && result.storyIndex !== undefined
    && result.subtitle !== undefined
    && result.understanding !== undefined
    && result.voiceover !== undefined
}

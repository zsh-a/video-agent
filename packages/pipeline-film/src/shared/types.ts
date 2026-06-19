export interface FilmAudioMixVoiceover {
  delayMs: number
  duration: number
  narrationId: string
  path: string
  resolvedPath: string
  start: number
}

export interface FilmAudioMix {
  duration: number
  ducking?: {
    attackMs: number
    ratio: number
    releaseMs: number
    threshold: number
  }
  generatedAt: string
  loudnessNormalization: {
    loudnessRangeLufs: number
    targetIntegratedLufs: number
    truePeakDb: number
  }
  mode: 'silence' | 'source-ducked' | 'source-only' | 'voiceover-only'
  outputPath: string
  sourceAudioRetained: boolean
  sourcePath: string
  version: 1
  voiceoverVolume: number
  sourceVolume: number
  sourceVolumeDuringVoiceover?: number
  voiceoverSegments: FilmAudioMixVoiceover[]
}

export interface FilmSubtitleOutput {
  cues: number
  format: 'srt'
  generatedAt: string
  path: string
  version: 1
}

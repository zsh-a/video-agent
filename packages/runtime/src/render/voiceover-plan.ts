export const VOICEOVER_ALIGNMENT_NARRATION_ID = 'narration-id' as const
export const VOICEOVER_ALIGNMENT_SEQUENTIAL = 'sequential' as const
export const VOICEOVER_ALIGNMENTS = [VOICEOVER_ALIGNMENT_NARRATION_ID, VOICEOVER_ALIGNMENT_SEQUENTIAL] as const
export type VoiceoverAlignment = (typeof VOICEOVER_ALIGNMENTS)[number]

export const VOICEOVER_STATUS_AVAILABLE = 'available' as const
export const VOICEOVER_STATUS_MISSING = 'missing' as const
export const VOICEOVER_SEGMENT_STATUSES = [VOICEOVER_STATUS_AVAILABLE, VOICEOVER_STATUS_MISSING] as const
export type VoiceoverPlanSegmentStatus = (typeof VOICEOVER_SEGMENT_STATUSES)[number]

export const MISSING_VOICEOVER_REASON = VOICEOVER_STATUS_MISSING
export type MissingVoiceoverReason = typeof MISSING_VOICEOVER_REASON

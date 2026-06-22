import {z} from 'zod'

export const QUALITY_ERROR_SEVERITY = 'error' as const
export const QUALITY_WARNING_SEVERITY = 'warning' as const
export const QUALITY_ISSUE_SEVERITIES = [QUALITY_ERROR_SEVERITY, QUALITY_WARNING_SEVERITY] as const
export type QualityIssueSeverity = (typeof QUALITY_ISSUE_SEVERITIES)[number]

export const QualityIssueSeveritySchema = z.enum(QUALITY_ISSUE_SEVERITIES)

import type {RecoveryOrderBy} from '@video-agent/pipeline-film'
import type {ProviderSmokeTestRole} from '@video-agent/runtime'

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-length') === '0') {
    return {}
  }

  const text = await request.text()

  if (text.trim() === '') {
    return {}
  }

  const parsed = JSON.parse(text) as unknown

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Request body must be a JSON object.')
  }

  return parsed as Record<string, unknown>
}

export function readStringField(body: Record<string, unknown>, field: string): null | string {
  const value = body[field]

  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new TypeError(`Field ${field} must be a string.`)
  }

  return value
}

export function readEnvQuery(params: URLSearchParams): Record<string, string> | undefined {
  const values = params.getAll('env')

  if (values.length === 0) {
    return undefined
  }

  return parseEnvAssignments(values)
}

export function readEnvField(body: Record<string, unknown>, field: string): Record<string, string> | undefined {
  if (body[field] === undefined || body[field] === null) {
    return undefined
  }

  if (typeof body[field] !== 'object' || Array.isArray(body[field])) {
    throw new TypeError(`Request field ${field} must be an object of string values.`)
  }

  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(body[field] as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      throw new TypeError(`Request field ${field}.${key} must be a string.`)
    }

    env[key] = value
  }

  return env
}

export function readCommandPrefix(params: URLSearchParams): string | undefined {
  const value = params.get('commandPrefix')

  if (value === null || value.trim() === '') {
    return undefined
  }

  return value
}

export function readBooleanField(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field]

  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new TypeError(`Field ${field} must be a boolean.`)
  }

  return value
}

export function readStringArrayField(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field]

  if (value === undefined || value === null) {
    return undefined
  }

  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`Field ${field} must be a non-empty string array.`)
  }

  return value
}

export function readNumberField(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field]

  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Field ${field} must be a finite number.`)
  }

  return value
}

export function parseOptionalInteger(value: null | string): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid integer query parameter: ${value}`)
  }

  return parsed
}

export function parseOptionalNumber(value: null | string): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`Invalid number query parameter: ${value}`)
  }

  return parsed
}

export function parseOptionalBoolean(value: null | string): boolean | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  throw new Error(`Invalid boolean query parameter: ${value}`)
}

export function parseOptionalEnum<T extends string>(value: null | string, values: readonly T[]): T | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  if (values.includes(value as T)) {
    return value as T
  }

  throw new Error(`Invalid query parameter: ${value}`)
}

export function resolveRecoverableStatuses(status: null | string): Array<'failed' | 'running'> | undefined {
  if (status === null || status === 'active') {
    return undefined
  }

  if (status === 'failed' || status === 'running') {
    return [status]
  }

  throw new Error(`Invalid worker status: ${status}`)
}

export function resolveProviderSmokeTestRoles(role: null | string): ProviderSmokeTestRole[] | undefined {
  if (role === null || role === 'all') {
    return undefined
  }

  if (role === 'asr' || role === 'tts' || role === 'vlm') {
    return [role]
  }

  throw new Error(`Invalid provider test role: ${role}`)
}

export function readRecoveryOrderBy(value: null | string): RecoveryOrderBy | undefined {
  if (value === null) {
    return undefined
  }

  if (value === 'attempt' || value === 'oldest' || value === 'recent') {
    return value
  }

  throw new Error(`Invalid worker orderBy: ${value}`)
}

function parseEnvAssignments(values: string[]): Record<string, string> {
  const env: Record<string, string> = {}

  for (const value of values) {
    const separatorIndex = value.indexOf('=')

    if (separatorIndex <= 0) {
      throw new Error(`Invalid env query value "${value}". Expected KEY=VALUE.`)
    }

    const key = value.slice(0, separatorIndex).trim()

    if (key.length === 0) {
      throw new Error(`Invalid env query value "${value}". Expected KEY=VALUE.`)
    }

    env[key] = value.slice(separatorIndex + 1)
  }

  return env
}

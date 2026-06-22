import {Flags} from '@oclif/core'
import {parseCommandArgvJson} from '@video-agent/providers'
import {DEFAULT_WORKSPACE_DIR} from '@video-agent/runtime'

export function workspaceFlag() {
  return Flags.string({default: DEFAULT_WORKSPACE_DIR, description: 'Workspace directory'})
}

export function normalizePositiveIntegerFlag(value: number | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 1 || Math.floor(value) !== value) {
    throw new TypeError(`${flagName} must be a positive integer.`)
  }

  return value
}

export function normalizeRequiredPositiveIntegerFlag(value: number | undefined, flagName: string): number {
  const normalized = normalizePositiveIntegerFlag(value, flagName)

  if (normalized === undefined) {
    throw new TypeError(`${flagName} is required.`)
  }

  return normalized
}

export function normalizeNonNegativeIntegerFlag(value: number | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value < 0 || Math.floor(value) !== value) {
    throw new TypeError(`${flagName} must be a non-negative integer.`)
  }

  return value
}

export function normalizeRequiredNonNegativeIntegerFlag(value: number | undefined, flagName: string): number {
  const normalized = normalizeNonNegativeIntegerFlag(value, flagName)

  if (normalized === undefined) {
    throw new TypeError(`${flagName} is required.`)
  }

  return normalized
}

export function parseOptionalEnumFlag<T extends string>(value: string | undefined, values: readonly T[], flagName: string): T | undefined {
  if (value === undefined) {
    return undefined
  }

  return parseRequiredEnumFlag(value, values, flagName)
}

export function parseRequiredEnumFlag<T extends string>(value: string | undefined, values: readonly T[], flagName: string): T {
  if (value === undefined || value.trim() === '') {
    throw new TypeError(`${flagName} is required.`)
  }

  if (values.includes(value as T)) {
    return value as T
  }

  throw new TypeError(`${flagName} must be one of: ${values.join(', ')}.`)
}

export function parseOptionalNumberFlag(value: string | undefined, flagName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${flagName} must be a finite number.`)
  }

  return parsed
}

export function parseCommandPrefixFlag(value: string | undefined, flagName: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    throw new TypeError(`${flagName} must not be empty.`)
  }

  if (!trimmed.startsWith('[')) {
    return [trimmed]
  }

  return parseCommandArgvJson(trimmed, {
    createError: (message) => new TypeError(message),
    invalidJsonDescription: 'a valid array of command arguments',
    invalidValueDescription: 'a non-empty array of non-empty strings',
    source: `${flagName} JSON value`,
  })
}

export function parseDurationSeconds(value: string): number {
  const trimmed = value.trim()
  const unitMatch = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(trimmed)

  if (unitMatch !== null) {
    const amount = Number(unitMatch[1])
    const unit = unitMatch[2]?.toLowerCase() ?? 's'

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new TypeError(`Invalid duration: ${value}`)
    }

    if (unit === 'ms') {
      return amount / 1000
    }

    if (unit === 'm') {
      return amount * 60
    }

    if (unit === 'h') {
      return amount * 3600
    }

    return amount
  }

  const parts = trimmed.split(':').map(Number)

  if (parts.length >= 2 && parts.length <= 3 && parts.every((part) => Number.isFinite(part) && part >= 0)) {
    const seconds = parts.length === 2
      ? parts[0] * 60 + parts[1]
      : parts[0] * 3600 + parts[1] * 60 + parts[2]

    if (seconds > 0) {
      return seconds
    }
  }

  throw new TypeError(`Invalid duration: ${value}`)
}

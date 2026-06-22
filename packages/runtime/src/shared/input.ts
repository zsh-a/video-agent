export interface InputReadOptions {
  createError(message: string): Error
  label: string
}

export interface StringArrayInputOptions extends InputReadOptions {
  allowEmpty?: boolean
  allowEmptyItems?: boolean
  description?: string
}

export function readOptionalStringInput(value: Record<string, unknown>, field: string, options: InputReadOptions): string | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  if (typeof item !== 'string') {
    throw options.createError(`${inputFieldLabel(options, field)} must be a string.`)
  }

  return item
}

export function readOptionalBooleanInput(value: Record<string, unknown>, field: string, options: InputReadOptions): boolean | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  if (typeof item !== 'boolean') {
    throw options.createError(`${inputFieldLabel(options, field)} must be a boolean.`)
  }

  return item
}

export function readOptionalNumberInput(value: Record<string, unknown>, field: string, options: InputReadOptions): number | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  if (typeof item !== 'number' || !Number.isFinite(item)) {
    throw options.createError(`${inputFieldLabel(options, field)} must be a finite number.`)
  }

  return item
}

export function readOptionalNonNegativeIntegerInput(value: Record<string, unknown>, field: string, options: InputReadOptions): number | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  if (!isIntegerInput(item, 0)) {
    throw options.createError(`${inputFieldLabel(options, field)} must be a non-negative integer.`)
  }

  return item
}

export function readOptionalPositiveIntegerInput(value: Record<string, unknown>, field: string, options: InputReadOptions): number | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  if (!isIntegerInput(item, 1)) {
    throw options.createError(`${inputFieldLabel(options, field)} must be a positive integer.`)
  }

  return item
}

export function readOptionalStringArrayInput(value: Record<string, unknown>, field: string, options: StringArrayInputOptions): string[] | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  const allowEmpty = options.allowEmpty ?? true
  const allowEmptyItems = options.allowEmptyItems ?? true
  const valid = Array.isArray(item)
    && (allowEmpty || item.length > 0)
    && item.every((entry) => typeof entry === 'string' && (allowEmptyItems || entry.length > 0))

  if (!valid) {
    throw options.createError(`${inputFieldLabel(options, field)} must be ${options.description ?? 'an array of strings'}.`)
  }

  return item as string[]
}

export function readOptionalStringRecordInput(value: Record<string, unknown>, field: string, options: InputReadOptions): Record<string, string> | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  if (!isRecord(item)) {
    throw options.createError(`${inputFieldLabel(options, field)} must be an object of string values.`)
  }

  const record: Record<string, string> = {}

  for (const [key, entry] of Object.entries(item)) {
    if (typeof entry !== 'string') {
      throw options.createError(`${inputFieldLabel(options, `${field}.${key}`)} must be a string.`)
    }

    record[key] = entry
  }

  return record
}

export function readOptionalEnumInput<T extends string>(value: Record<string, unknown>, field: string, values: readonly T[], options: InputReadOptions): T | undefined {
  const item = readOptionalInput(value, field)

  if (item === undefined) {
    return undefined
  }

  if (typeof item === 'string' && values.includes(item as T)) {
    return item as T
  }

  throw options.createError(`${inputFieldLabel(options, field)} must be one of: ${values.join(', ')}.`)
}

export function readOptionalInput(value: Record<string, unknown>, field: string): unknown | undefined {
  const item = value[field]

  return item === null ? undefined : item
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inputFieldLabel(options: InputReadOptions, field: string): string {
  return `${options.label} ${field}`
}

function isIntegerInput(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum
}

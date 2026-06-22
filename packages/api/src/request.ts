import {
  isRecord,
  parseEnvAssignments,
  readOptionalBooleanInput,
  readOptionalNonNegativeIntegerInput,
  readOptionalNumberInput,
  readOptionalPositiveIntegerInput,
  readOptionalStringArrayInput,
  readOptionalStringInput,
  readOptionalStringRecordInput,
} from '@video-agent/runtime'

export class ApiRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

const API_FIELD_READER = {
  createError: createApiRequestError,
  label: 'Field',
}

const API_REQUEST_FIELD_READER = {
  createError: createApiRequestError,
  label: 'Request field',
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-length') === '0') {
    return {}
  }

  const text = await request.text()

  if (text.trim() === '') {
    return {}
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new ApiRequestError('Request body must be valid JSON.')
  }

  if (!isRecord(parsed)) {
    throw new ApiRequestError('Request body must be a JSON object.')
  }

  return parsed
}

export function readStringField(body: Record<string, unknown>, field: string): null | string {
  return readOptionalStringInput(body, field, API_FIELD_READER) ?? null
}

export function readEnvQuery(params: URLSearchParams): Record<string, string> | undefined {
  const values = params.getAll('env')

  if (values.length === 0) {
    return undefined
  }

  return parseEnvAssignments(values, 'env query value')
}

export function readEnvField(body: Record<string, unknown>, field: string): Record<string, string> | undefined {
  return readOptionalStringRecordInput(body, field, API_REQUEST_FIELD_READER)
}

export function readCommandPrefix(params: URLSearchParams): string | undefined {
  const value = params.get('commandPrefix')

  if (value === null || value.trim() === '') {
    return undefined
  }

  return value
}

export function readBooleanField(body: Record<string, unknown>, field: string): boolean | undefined {
  return readOptionalBooleanInput(body, field, API_FIELD_READER)
}

export function readStringArrayField(body: Record<string, unknown>, field: string): string[] | undefined {
  return readOptionalStringArrayInput(body, field, {
    ...API_FIELD_READER,
    allowEmpty: false,
    allowEmptyItems: false,
    description: 'a non-empty string array',
  })
}

export function readNumberField(body: Record<string, unknown>, field: string): number | undefined {
  return readOptionalNumberInput(body, field, API_FIELD_READER)
}

export function readNonNegativeIntegerField(body: Record<string, unknown>, field: string): number | undefined {
  return readOptionalNonNegativeIntegerInput(body, field, API_FIELD_READER)
}

export function readPositiveIntegerField(body: Record<string, unknown>, field: string): number | undefined {
  return readOptionalPositiveIntegerInput(body, field, API_FIELD_READER)
}

export function parseOptionalNonNegativeInteger(value: null | string): number | undefined {
  return parseOptionalIntegerWithMinimum(value, 0, 'non-negative')
}

export function parseOptionalPositiveInteger(value: null | string): number | undefined {
  return parseOptionalIntegerWithMinimum(value, 1, 'positive')
}

function parseOptionalIntegerWithMinimum(value: null | string, minimum: number, description: string): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new ApiRequestError(`Invalid ${description} integer query parameter: ${value}`)
  }

  return parsed
}

export function parseOptionalNumber(value: null | string): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed)) {
    throw new ApiRequestError(`Invalid number query parameter: ${value}`)
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

  throw new ApiRequestError(`Invalid boolean query parameter: ${value}`)
}

export function parseOptionalEnum<T extends string>(value: null | string, values: readonly T[]): T | undefined {
  if (value === null || value.trim() === '') {
    return undefined
  }

  if (values.includes(value as T)) {
    return value as T
  }

  throw new ApiRequestError(`Invalid query parameter: ${value}`)
}

export function parseRequiredEnum<T extends string>(value: null | string, field: string, values: readonly T[]): T {
  if (value === null || value.trim() === '') {
    throw new ApiRequestError(`Field ${field} is required and must be one of: ${values.join(', ')}.`)
  }

  const parsed = parseOptionalEnum(value, values)

  if (parsed === undefined) {
    throw new ApiRequestError(`Field ${field} is required and must be one of: ${values.join(', ')}.`)
  }

  return parsed
}

function createApiRequestError(message: string): ApiRequestError {
  return new ApiRequestError(message)
}

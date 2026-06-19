export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readArrayLength(value: unknown, field: string): number {
  if (!isRecord(value) || !Array.isArray(value[field])) {
    return 0
  }

  return value[field].length
}

export function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readNonnegativeNumber(value: unknown): number | undefined {
  const number = readFiniteNumber(value)

  return number === undefined || number < 0 ? undefined : number
}

export interface IssueCountLike {
  errors?: unknown
  warnings?: unknown
}

export function readIssueErrors(value: IssueCountLike | undefined): number {
  return readNonnegativeNumber(value?.errors) ?? 0
}

export function readIssueWarnings(value: IssueCountLike | undefined): number {
  return readNonnegativeNumber(value?.warnings) ?? 0
}

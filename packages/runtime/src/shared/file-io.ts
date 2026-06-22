import type {z} from 'zod'

import {readFile} from 'node:fs/promises'

interface JsonLineErrorDetails {
  filePath: string
  issues: string
  line: number
}

interface JsonFileErrorDetails {
  filePath: string
  issues: string
}

export interface JsonLineEntry {
  line: number
  value: unknown
}

export interface JsonLineParseIssue {
  issues: string
  line: number
}

export class JsonFileParseError extends Error {
  constructor(
    message: string,
    readonly details: JsonFileErrorDetails,
  ) {
    super(message)
    this.name = 'JsonFileParseError'
  }
}

export class JsonLineReadError extends Error {
  constructor(
    message: string,
    readonly details: JsonLineErrorDetails,
  ) {
    super(message)
    this.name = 'JsonLineReadError'
  }
}

export class JsonLineParseError extends JsonLineReadError {
  constructor(message: string, details: JsonLineErrorDetails) {
    super(message, details)
    this.name = 'JsonLineParseError'
  }
}

export class JsonLineSchemaValidationError extends JsonLineReadError {
  constructor(message: string, details: JsonLineErrorDetails) {
    super(message, details)
    this.name = 'JsonLineSchemaValidationError'
  }
}

export async function readJsonLines(path: string): Promise<unknown[]> {
  const lines = await readJsonLineEntries(path)

  return lines.map((line) => line.value)
}

export async function readParsedJsonLines<T>(path: string, schema: z.ZodType<T>): Promise<T[]> {
  const lines = await readJsonLineEntries(path)

  return lines.map((line) => {
    const result = schema.safeParse(line.value)

    if (!result.success) {
      const issues = formatZodIssues(result.error.issues)
      throw new JsonLineSchemaValidationError(`JSONL file ${path} line ${line.line} failed schema validation. ${issues}`, {
        filePath: path,
        issues,
        line: line.line,
      })
    }

    return result.data
  })
}

async function readJsonLineEntries(path: string): Promise<JsonLineEntry[]> {
  const text = await readOptionalText(path)

  if (text === undefined) {
    return []
  }

  return parseJsonLinesText(path, text)
}

export function parseJsonLinesText(path: string, text: string): JsonLineEntry[] {
  const result = parseJsonLinesTextWithIssues(text)
  const firstParseIssue = result.parseIssues[0]

  if (firstParseIssue !== undefined) {
    throw new JsonLineParseError(`JSONL file ${path} line ${firstParseIssue.line} is not valid JSON. ${firstParseIssue.issues}`, {
      filePath: path,
      issues: firstParseIssue.issues,
      line: firstParseIssue.line,
    })
  }

  return result.entries
}

export function parseJsonLinesTextWithIssues(text: string): {entries: JsonLineEntry[]; parseIssues: JsonLineParseIssue[]} {
  const entries: JsonLineEntry[] = []
  const parseIssues: JsonLineParseIssue[] = []

  text.split('\n').forEach((line, index) => {
    const lineNumber = index + 1

    if (line.trim() === '') {
      return
    }

    try {
      entries.push({line: lineNumber, value: JSON.parse(line) as unknown})
    } catch (error) {
      parseIssues.push({
        issues: formatErrorMessage(error),
        line: lineNumber,
      })
    }
  })

  return {entries, parseIssues}
}

export function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`).join('; ')
}

export async function readOptionalJson(path: string): Promise<unknown | undefined> {
  const text = await readOptionalText(path)

  if (text === undefined) {
    return undefined
  }

  return parseJsonText(path, text)
}

export function parseJsonText(path: string, text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    const issues = formatErrorMessage(error)

    throw new JsonFileParseError(`JSON file ${path} is not valid JSON. ${issues}`, {
      filePath: path,
      issues,
    })
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }

    throw error
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

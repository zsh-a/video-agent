import {resolve} from 'node:path'

interface BunFile {
  text(): Promise<string>
}

interface BunRuntime {
  env: Record<string, string | undefined>
  file(path: string): BunFile
}

export async function readRuntimeEnv(workspaceDir = '.video-agent', env: Record<string, string | undefined> = getBunEnv()): Promise<Record<string, string | undefined>> {
  const workspaceEnvPath = resolve(workspaceDir, '.env')
  const dotenv = await readDotEnvFile(workspaceEnvPath)

  return {
    ...dotenv,
    ...env,
  }
}

async function readDotEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseDotEnv(await getBunRuntime().file(path).text(), path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {}
    }

    throw error
  }
}

function parseDotEnv(contents: string, path: string): Record<string, string> {
  const env: Record<string, string> = {}
  const normalized = contents.codePointAt(0) === 0xFE_FF ? contents.slice(1) : contents
  const lines = normalized.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    const parsed = parseDotEnvLine(line, path, index + 1)

    if (parsed !== undefined) {
      env[parsed.key] = parsed.value
    }
  }

  return env
}

function parseDotEnvLine(line: string, path: string, lineNumber: number): undefined | {key: string; value: string} {
  const trimmed = line.trim()

  if (trimmed === '' || trimmed.startsWith('#')) {
    return undefined
  }

  const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trimStart() : trimmed
  const equalsIndex = assignment.indexOf('=')

  if (equalsIndex < 1) {
    throw new Error(`${path}:${lineNumber} must be a KEY=VALUE assignment.`)
  }

  const key = assignment.slice(0, equalsIndex).trim()

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`${path}:${lineNumber} has invalid environment variable name: ${key}`)
  }

  return {
    key,
    value: normalizeDotEnvValue(assignment.slice(equalsIndex + 1).trim()),
  }
}

function normalizeDotEnvValue(value: string): string {
  if (value.startsWith('"')) {
    return unquoteDotEnvValue(value, '"')
      .replaceAll(String.raw`\n`, '\n')
      .replaceAll(String.raw`\r`, '\r')
      .replaceAll(String.raw`\t`, '\t')
      .replaceAll(String.raw`\"`, '"')
      .replaceAll(String.raw`\\`, '\\')
  }

  if (value.startsWith("'")) {
    return unquoteDotEnvValue(value, "'")
  }

  return stripInlineComment(value).trim()
}

function unquoteDotEnvValue(value: string, quote: string): string {
  const end = value.lastIndexOf(quote)

  if (end <= 0) {
    throw new Error('Quoted .env value is missing a closing quote.')
  }

  return value.slice(1, end)
}

function stripInlineComment(value: string): string {
  const commentIndex = value.search(/\s+#/)

  return commentIndex === -1 ? value : value.slice(0, commentIndex)
}

function getBunEnv(): Record<string, string | undefined> {
  return getBunRuntime().env
}

function getBunRuntime(): BunRuntime {
  const bun = (globalThis as typeof globalThis & {Bun?: BunRuntime}).Bun

  if (bun === undefined) {
    throw new Error('readRuntimeEnv requires Bun runtime.')
  }

  return bun
}

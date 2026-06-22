import {providerEnvName, type ProviderRole} from './descriptors.js'

export interface CommandArgvJsonParseOptions {
  createError?: (message: string) => Error
  invalidJsonDescription?: string
  invalidValueDescription?: string
  source: string
}

export function resolveProviderCommandArgv(role: ProviderRole, env: Record<string, string | undefined>): string[] {
  const name = providerEnvName(role, 'COMMAND')
  const value = env[name]

  if (value === undefined || value.trim() === '') {
    throw new Error(`Provider ${role} is set to command, but ${name} is not configured.`)
  }

  return parseCommandArgvJson(value, {source: name})
}

export function parseCommandArgvJson(value: string, options: CommandArgvJsonParseOptions): string[] {
  const createError = options.createError ?? ((message: string) => new Error(message))
  let parsed: unknown

  try {
    parsed = JSON.parse(value) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw createError(`${options.source} must be ${options.invalidJsonDescription ?? 'a JSON array of command arguments'}: ${message}`)
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((part) => typeof part !== 'string' || part.trim() === '')) {
    throw createError(`${options.source} must be ${options.invalidValueDescription ?? 'a non-empty JSON array of non-empty strings'}.`)
  }

  return parsed
}

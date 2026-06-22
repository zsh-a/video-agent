export function parseEnvAssignments(values: string[], source = 'env assignment'): Record<string, string> {
  const env: Record<string, string> = {}

  for (const value of values) {
    const separatorIndex = value.indexOf('=')

    if (separatorIndex <= 0) {
      throw new Error(`Invalid ${source} "${value}". Expected KEY=VALUE.`)
    }

    const key = value.slice(0, separatorIndex).trim()

    if (key.length === 0) {
      throw new Error(`Invalid ${source} "${value}". Expected KEY=VALUE.`)
    }

    env[key] = value.slice(separatorIndex + 1)
  }

  return env
}

export function normalizeEnvAssignments(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (env === undefined || Object.keys(env).length === 0) {
    return undefined
  }

  return Object.fromEntries(Object.entries(env).sort(([left], [right]) => left.localeCompare(right)))
}

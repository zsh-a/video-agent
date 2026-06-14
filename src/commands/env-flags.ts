export function parseEnvFlags(values: string[]): Record<string, string> {
  const env: Record<string, string> = {}

  for (const value of values) {
    const separatorIndex = value.indexOf('=')

    if (separatorIndex <= 0) {
      throw new Error(`Invalid --env value "${value}". Expected KEY=VALUE.`)
    }

    const key = value.slice(0, separatorIndex).trim()

    if (key.length === 0) {
      throw new Error(`Invalid --env value "${value}". Expected KEY=VALUE.`)
    }

    env[key] = value.slice(separatorIndex + 1)
  }

  return env
}

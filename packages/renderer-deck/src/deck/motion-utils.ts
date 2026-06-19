export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function cssEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

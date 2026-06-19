export function normalizeText(value: string): string {
  return value.replaceAll(/\r\n?/g, '\n').replaceAll(/[ \t]+/g, ' ').trim()
}

export function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000
}

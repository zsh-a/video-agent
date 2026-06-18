const THEME_TOKEN_KEYS = [
  'bg',
  'bg-2',
  'surface',
  'surface-strong',
  'surface-soft',
  'fg',
  'muted',
  'line',
  'line-soft',
  'accent',
  'accent-2',
  'accent-warm',
  'shadow',
] as const

interface ThemeTokenSet {
  colorScheme?: 'light'
  name: string
  values: readonly string[]
}

const THEME_TOKEN_SETS: readonly ThemeTokenSet[] = [
  {
    name: 'elegant-dark',
    values: ['#080b12', '#111827', 'rgb(244 248 255 / 8%)', 'rgb(244 248 255 / 14%)', 'rgb(15 23 42 / 72%)', '#f7fafc', '#aeb9c8', 'rgb(217 226 239 / 22%)', 'rgb(217 226 239 / 10%)', '#56d6ff', '#58e6a9', '#f6c96b', 'rgb(0 0 0 / 34%)'],
  },
  {
    colorScheme: 'light',
    name: 'clean-white',
    values: ['#f7f8f5', '#e9eee9', 'rgb(10 16 24 / 5%)', 'rgb(10 16 24 / 9%)', 'rgb(255 255 255 / 82%)', '#121619', '#5b6670', 'rgb(18 22 25 / 16%)', 'rgb(18 22 25 / 8%)', '#0b7f72', '#2563eb', '#b45309', 'rgb(16 24 40 / 12%)'],
  },
  {
    name: 'finance-terminal',
    values: ['#07100f', '#111b1d', 'rgb(237 248 244 / 8%)', 'rgb(237 248 244 / 15%)', 'rgb(9 28 27 / 74%)', '#f4fff9', '#a7bbb3', 'rgb(196 231 218 / 20%)', 'rgb(196 231 218 / 9%)', '#43e59b', '#4cc9f0', '#f2c15d', 'rgb(0 0 0 / 36%)'],
  },
  {
    name: 'tech-gradient',
    values: ['#071019', '#101827', 'rgb(226 240 255 / 8%)', 'rgb(226 240 255 / 15%)', 'rgb(15 24 38 / 78%)', '#f8fbff', '#a8b8c9', 'rgb(213 233 255 / 20%)', 'rgb(213 233 255 / 9%)', '#31d8ff', '#b8ec5b', '#fb8b96', 'rgb(0 0 0 / 34%)'],
  },
  {
    colorScheme: 'light',
    name: 'minimal-editorial',
    values: ['#f6f4ef', '#e9e4da', 'rgb(24 24 27 / 6%)', 'rgb(24 24 27 / 11%)', 'rgb(255 254 250 / 84%)', '#191a1d', '#64605a', 'rgb(54 50 45 / 18%)', 'rgb(54 50 45 / 8%)', '#1d4ed8', '#0f766e', '#b45309', 'rgb(30 41 59 / 12%)'],
  },
  {
    colorScheme: 'light',
    name: 'warm-paper',
    values: ['#fff7ed', '#f0e2cf', 'rgb(67 20 7 / 7%)', 'rgb(67 20 7 / 12%)', 'rgb(255 251 235 / 82%)', '#1c1917', '#72695f', 'rgb(120 113 108 / 20%)', 'rgb(120 113 108 / 9%)', '#0f766e', '#5b6ee1', '#d97706', 'rgb(67 20 7 / 12%)'],
  },
]

export function themeTokensCss(): string {
  return THEME_TOKEN_SETS.map((theme) => {
    const declarations = theme.values
      .map((value, index) => `  --${THEME_TOKEN_KEYS[index]}: ${value};`)
      .join('\n')
    const colorScheme = theme.colorScheme === undefined ? '' : '  color-scheme: light;\n'

    return `body[data-theme="${theme.name}"] {
${colorScheme}${declarations}
}`
  }).join('\n\n')
}

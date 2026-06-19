export interface TailwindDirectivesOptions {
  sourceHtmlPath: string
  tailwindCssPath: string
}

export function tailwindDirectives(options: TailwindDirectivesOptions): string {
  return `@import "${escapeCssString(options.tailwindCssPath)}";
@source "${escapeCssString(options.sourceHtmlPath)}";

@theme inline {
  --color-deck-bg: var(--bg);
  --color-deck-surface: var(--surface);
  --color-deck-surface-strong: var(--surface-strong);
  --color-deck-surface-soft: var(--surface-soft);
  --color-deck-fg: var(--fg);
  --color-deck-muted: var(--muted);
  --color-deck-line: var(--line);
  --color-deck-line-soft: var(--line-soft);
  --color-deck-accent: var(--accent);
  --color-deck-accent-2: var(--accent-2);
  --color-deck-accent-warm: var(--accent-warm);
  --font-sans: "Noto Sans SC", ui-sans-serif, system-ui, sans-serif;
  --text-deck-title: var(--font-title);
  --text-deck-heading: var(--font-heading);
  --text-deck-body: var(--font-body);
  --text-deck-caption: var(--font-caption);
  --leading-deck-title: var(--line-title);
  --leading-deck-body: var(--line-body);
  --radius-deck-card: var(--radius-card);
  --shadow-deck-card: var(--shadow-card);
}`
}

function escapeCssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\a ')
}

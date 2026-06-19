export function captureCss(): string {
  return `body[data-capture="slide"] {
  height: var(--canvas-h);
  overflow: hidden;
  width: var(--canvas-w);
}

body[data-capture="slide"] .stage {
  height: var(--canvas-h);
  width: var(--canvas-w);
}

body[data-capture="slide"] .slide__chrome {
  opacity: 0.72;
}`
}

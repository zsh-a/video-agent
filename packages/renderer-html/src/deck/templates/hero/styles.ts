export const heroStyles = `.slide--hero .slide__content {
  align-content: center;
  gap: 42px;
}

.slide--hero .slide__title {
  background: linear-gradient(135deg, var(--fg) 0%, color-mix(in srgb, var(--accent) 74%, var(--fg)) 54%, color-mix(in srgb, var(--accent-warm) 54%, var(--fg)) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: var(--font-title);
  max-width: 11em;
}

.hero__points {
  display: grid;
  gap: 18px;
}

body[data-format="landscape_1920x1080"] .hero__points {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}`

export const heroStyles = `.slide--hero .slide__content {
  align-content: center;
  gap: 42px;
  text-align: center;
}

.slide--hero .slide__header {
  justify-items: center;
}

.slide--hero .slide__title {
  background: linear-gradient(135deg, var(--fg) 0%, color-mix(in srgb, var(--accent) 74%, var(--fg)) 54%, color-mix(in srgb, var(--accent-warm) 54%, var(--fg)) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: var(--font-title);
  max-width: 12em;
}

.slide--hero .slide__subtitle {
  font-size: var(--font-heading);
  max-width: 18em;
  opacity: 0.86;
}

.hero__taglines {
  display: flex;
  flex-wrap: wrap;
  gap: 18px 32px;
  justify-content: center;
  max-width: 48em;
}

.hero__taglines--single {
  justify-items: center;
}

.hero__tagline {
  color: var(--accent);
  font-size: var(--font-body);
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: var(--line-body);
  opacity: 0.92;
  position: relative;
}

.hero__tagline + .hero__tagline::before {
  background: var(--line);
  content: "";
  height: 1em;
  left: -18px;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
}

.hero__glow {
  background: radial-gradient(ellipse 52% 48% at 68% 72%, color-mix(in srgb, var(--accent) 16%, transparent), transparent);
  bottom: 0;
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  z-index: 0;
}
`

export const sectionStyles = `.slide--section .slide__content {
  align-content: center;
  text-align: center;
}

.slide--section .slide__header {
  justify-items: center;
}

.slide--section .slide__title {
  background: linear-gradient(90deg, var(--fg), color-mix(in srgb, var(--accent) 56%, var(--fg)));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: var(--font-title);
}

.section__rule {
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-warm));
  border-radius: 999px;
  height: 6px;
  position: relative;
  transform-origin: left center;
  width: min(720px, 80%);
}

.section__rule::after {
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 36%, transparent), transparent);
  content: "";
  height: 1px;
  left: 0;
  position: absolute;
  top: 18px;
  width: 100%;
}

.section__orb {
  background: radial-gradient(circle at 72% 78%, color-mix(in srgb, var(--accent-2) 12%, transparent), transparent 60%);
  bottom: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  top: 0;
  width: 60%;
  z-index: 0;
}`

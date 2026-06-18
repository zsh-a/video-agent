export const sectionStyles = `.slide--section .slide__content {
  align-content: center;
}

.slide--section .slide__title {
  background: linear-gradient(90deg, var(--fg), color-mix(in srgb, var(--accent) 56%, var(--fg)));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.section__rule {
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-warm));
  border-radius: 999px;
  height: 5px;
  position: relative;
  transform-origin: left center;
  width: min(620px, 72%);
}

.section__rule::after {
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 42%, transparent), transparent);
  content: "";
  height: 1px;
  left: 0;
  position: absolute;
  top: 16px;
  width: 100%;
}`

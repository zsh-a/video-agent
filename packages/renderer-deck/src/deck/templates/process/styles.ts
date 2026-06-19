export const processStyles = `.process-list li {
  border-left: 3px solid color-mix(in srgb, var(--accent) 50%, transparent);
}

.process-list li + li::before {
  background: linear-gradient(180deg, var(--accent-2), color-mix(in srgb, var(--accent) 30%, transparent));
  content: "";
  height: 18px;
  left: calc(var(--safe-x) + 39px);
  position: absolute;
  top: -18px;
  width: 2px;
}

.process-list--dense {
  gap: 16px;
}

.process-list--dense li {
  min-height: 86px;
  padding: 18px 22px;
}

.process-list--dense p {
  font-size: calc(var(--font-body) * 0.84);
}

body[data-format="landscape_1920x1080"] .process-list--grid,
body[data-format="square_1080x1080"] .process-list--grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

body[data-format="landscape_1920x1080"] .process-list--grid li,
body[data-format="square_1080x1080"] .process-list--grid li {
  align-content: start;
  align-items: start;
  gap: 22px;
  grid-template-columns: 1fr;
  min-height: 245px;
  padding: 28px;
}

body[data-format="landscape_1920x1080"] .process-list--grid li + li::before,
body[data-format="square_1080x1080"] .process-list--grid li + li::before {
  display: none;
}

body[data-format="landscape_1920x1080"] .process-list--grid p,
body[data-format="square_1080x1080"] .process-list--grid p {
  font-size: calc(var(--font-body) * 0.82);
}

body[data-format="landscape_1920x1080"] .process-list--dense,
body[data-format="square_1080x1080"] .process-list--dense {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

body[data-format="landscape_1920x1080"] .process-list--dense li + li::before,
body[data-format="square_1080x1080"] .process-list--dense li + li::before {
  display: none;
}`

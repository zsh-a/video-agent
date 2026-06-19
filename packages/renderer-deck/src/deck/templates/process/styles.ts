export const processStyles = `.process-list li::after {
  background: linear-gradient(90deg, var(--accent), transparent);
  bottom: 0;
  content: "";
  height: 2px;
  left: 0;
  opacity: 0.8;
  position: absolute;
  right: 0;
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

body[data-format="landscape_1920x1080"] .process-list--grid p,
body[data-format="square_1080x1080"] .process-list--grid p {
  font-size: calc(var(--font-body) * 0.82);
}

body[data-format="landscape_1920x1080"] .process-list--dense,
body[data-format="square_1080x1080"] .process-list--dense {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}`

export const comparisonStyles = `.comparison__side::before {
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  content: "";
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.comparison__side--right::before {
  background: linear-gradient(90deg, var(--accent-warm), var(--accent-2));
}

.comparison__side h2 {
  color: var(--accent);
  letter-spacing: 0;
}

.comparison__side--right h2 {
  color: var(--accent-warm);
}

.comparison__side li::before {
  background: var(--accent);
  border-radius: 999px;
  content: "";
  height: 7px;
  left: 0;
  position: absolute;
  top: 0.64em;
  width: 7px;
}

.comparison__side--right li::before {
  background: var(--accent-warm);
}

body[data-format="portrait_1080x1920"] .comparison {
  grid-template-columns: 1fr;
}

body[data-format="portrait_1080x1920"] .comparison__side {
  gap: 18px;
  padding: 28px;
}

body[data-format="portrait_1080x1920"] .comparison__side h2 {
  font-size: calc(var(--font-body) * 0.84);
}

body[data-format="portrait_1080x1920"] .comparison__side li {
  font-size: calc(var(--font-body) * 0.74);
}`

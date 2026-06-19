export function componentCss(): string {
  return `.point,
.process-list li,
.idea-card,
.quote-block,
.stat-block,
.cta-block,
.code-block,
.comparison__side {
  background:
    linear-gradient(135deg, var(--surface-strong), var(--surface-soft)),
    var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-card);
  position: relative;
}

.point {
  align-items: start;
  display: grid;
  gap: 18px;
  grid-template-columns: auto 1fr;
  overflow: hidden;
  padding: 22px 26px;
  will-change: opacity, transform, filter;
}

.point::before {
  background: linear-gradient(180deg, var(--accent), var(--accent-2));
  content: "";
  inset: 0 auto 0 0;
  opacity: 0.82;
  position: absolute;
  width: 3px;
}

.point__index,
.process-list li span {
  color: var(--accent);
  font-size: var(--font-caption);
  font-weight: 700;
  line-height: 1.2;
}

.process-step__badge {
  align-items: center;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-radius: 999px;
  color: var(--bg);
  display: grid;
  font-size: var(--font-caption);
  font-weight: 700;
  height: 38px;
  letter-spacing: 0.02em;
  line-height: 1;
  place-items: center;
  width: 38px;
}

.point p,
.process-list p,
.timeline__item p {
  color: var(--fg);
  font-size: var(--font-body);
  line-height: var(--line-body);
  margin: 0;
}

.slide--dense .point {
  padding: 19px 23px;
}

.slide--dense .point p,
.slide--dense .process-list p {
  font-size: calc(var(--font-body) * 0.84);
}

.idea-card::before,
.cta-block::before {
  background: linear-gradient(90deg, var(--accent), var(--accent-2), var(--accent-warm));
  content: "";
  height: 3px;
  left: 0;
  position: absolute;
  right: 0;
  top: 0;
}

.idea-card,
.cta-block,
.comparison__side,
.quote-block,
.code-block {
  overflow: hidden;
}`
}

export const summaryStyles = `.summary__points {
  display: grid;
  gap: 22px;
}

.summary__points .point__index {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  border-radius: 999px;
  color: var(--bg);
  display: grid;
  font-size: 0;
  height: 32px;
  place-items: center;
  width: 32px;
}

.summary__points .point__index::before {
  color: var(--bg);
  content: "\\2713";
  font-size: var(--font-caption);
  font-weight: 700;
}`

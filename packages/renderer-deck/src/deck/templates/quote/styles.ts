export const quoteStyles = `.quote-block {
  border-left: 4px solid var(--accent);
}

.quote-block::after {
  color: color-mix(in srgb, var(--accent) 20%, transparent);
  content: "\\201C";
  font-size: calc(var(--font-title) * 2);
  font-weight: 700;
  line-height: 1;
  position: absolute;
  right: 36px;
  top: 20px;
}`

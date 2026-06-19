export const codeStyles = `.code-block__header span:first-child {
  color: var(--accent);
}

body[data-format="landscape_1920x1080"] .code-block__body {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.code-line {
  border-bottom-color: var(--line-soft);
}

.code-line:nth-child(odd) {
  background: rgb(255 255 255 / 3%);
}

body[data-theme="clean-white"] .code-block,
body[data-theme="minimal-editorial"] .code-block,
body[data-theme="warm-paper"] .code-block {
  background:
    linear-gradient(135deg, rgb(17 24 39 / 96%), rgb(31 41 55 / 96%)),
    #111827;
  color-scheme: dark;
}

body[data-theme="clean-white"] .code-line code,
body[data-theme="minimal-editorial"] .code-line code,
body[data-theme="warm-paper"] .code-line code {
  color: #f9fafb;
}

body[data-format="portrait_1080x1920"] .code-block {
  max-height: 1120px;
}

body[data-format="portrait_1080x1920"] .code-line code {
  font-size: calc(var(--font-caption) * 0.86);
}`

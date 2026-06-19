export const chartStyles = `.chart-bar i {
  position: relative;
  width: var(--bar-value);
}

.chart-bar i::after {
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 32%));
  content: "";
  height: 100%;
  position: absolute;
  right: 0;
  width: 40%;
}`

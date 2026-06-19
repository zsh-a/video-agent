export const STUDIO_STYLE = String.raw`    :root {
      color-scheme: light;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.4;
      color: #172026;
      background: #f6f7f9;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 24px;
      border-bottom: 1px solid #d9dee5;
      background: #ffffff;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      font-size: 18px;
      font-weight: 700;
    }

    h2 {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      color: #5c6875;
    }

    button {
      border: 1px solid #b9c2ce;
      border-radius: 6px;
      background: #ffffff;
      color: #172026;
      cursor: pointer;
      font: inherit;
      min-height: 32px;
      padding: 6px 10px;
    }

    select {
      border: 1px solid #b9c2ce;
      border-radius: 6px;
      background: #ffffff;
      color: #172026;
      font: inherit;
      min-height: 32px;
      padding: 6px 28px 6px 10px;
    }

    button[aria-pressed="true"] {
      border-color: #1769aa;
      background: #e8f2fb;
    }

    select:disabled,
    button:disabled {
      color: #8a96a3;
      cursor: not-allowed;
      background: #f1f3f5;
    }

    main {
      display: grid;
      grid-template-columns: minmax(220px, 320px) 1fr;
      min-height: calc(100vh - 69px);
    }

    aside {
      border-right: 1px solid #d9dee5;
      background: #ffffff;
      padding: 16px;
    }

    section {
      padding: 18px 20px;
    }

    .stack {
      display: grid;
      gap: 12px;
    }

    .project-list {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .project-list button {
      display: grid;
      gap: 3px;
      justify-items: start;
      width: 100%;
      text-align: left;
    }

    .muted {
      color: #657384;
      font-size: 12px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .panel {
      border: 1px solid #d9dee5;
      border-radius: 8px;
      background: #ffffff;
      padding: 14px;
    }

    .metric {
      font-size: 24px;
      font-weight: 700;
      margin-top: 8px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .action-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .control-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(140px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .control {
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: #42515f;
    }

    .control input,
    .control select {
      width: 100%;
    }

    .control input[type="checkbox"] {
      justify-self: start;
      min-height: 18px;
      width: 18px;
    }

    .status-line {
      min-height: 20px;
      margin-top: 10px;
      color: #42515f;
      font-size: 13px;
      overflow-wrap: anywhere;
    }

    .summary-line {
      margin-top: 8px;
      color: #42515f;
      font-size: 13px;
    }

    .severity {
      border-radius: 999px;
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      min-width: 58px;
      padding: 2px 7px;
      text-align: center;
      text-transform: uppercase;
    }

    .severity--error {
      background: #fde8e8;
      color: #a61b1b;
    }

    .severity--warning {
      background: #fff4d6;
      color: #8a5a00;
    }

    .preview {
      max-height: 260px;
      overflow: auto;
      margin-top: 12px;
      border: 1px solid #d9dee5;
      border-radius: 6px;
      background: #f8fafc;
      padding: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 12px;
    }

    .sample-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .sample {
      border: 1px solid #d9dee5;
      border-radius: 6px;
      background: #f8fafc;
      padding: 8px;
    }

    .sample img {
      display: block;
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: contain;
      background: #111820;
      border-radius: 4px;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }

    th,
    td {
      border-bottom: 1px solid #e3e7ed;
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
    }

    th {
      color: #5c6875;
      font-weight: 700;
    }

    code {
      background: #eef1f5;
      border-radius: 4px;
      padding: 1px 4px;
    }

    @media (max-width: 760px) {
      main,
      .grid {
        grid-template-columns: 1fr;
      }

      aside {
        border-right: 0;
        border-bottom: 1px solid #d9dee5;
      }
    }`

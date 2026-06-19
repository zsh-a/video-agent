import {STUDIO_CLIENT_SCRIPT} from './client.js'
import {STUDIO_STYLE} from './style.js'

export function renderStudioHtml(): string {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>video-agent studio</title>
  <style>
${STUDIO_STYLE}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>video-agent studio</h1>
      <p class="muted" id="workspace">Loading workspace</p>
    </div>
    <div class="header-actions">
      <span class="mode-badge">Review mode</span>
      <button id="refresh" type="button">Refresh</button>
    </div>
  </header>
  <main>
    <aside>
      <h2>Projects</h2>
      <div class="project-list" id="projects"></div>
    </aside>
    <section class="stack">
      <div class="grid">
        <div class="panel">
          <h2>Status</h2>
          <p class="metric" id="status">none</p>
          <p class="summary-line" id="status-summary">No project selected.</p>
        </div>
        <div class="panel">
          <h2>Quality</h2>
          <p class="metric" id="quality">none</p>
          <p class="summary-line" id="quality-summary">No quality report.</p>
        </div>
        <div class="panel">
          <h2>Render</h2>
          <p class="metric" id="render">none</p>
          <p class="summary-line" id="render-summary">No rendered output.</p>
        </div>
      </div>
      <div class="grid">
        <div class="panel">
          <h2>Artifacts</h2>
          <p class="metric" id="artifact-count">0</p>
          <p class="summary-line" id="artifact-summary">No artifacts.</p>
        </div>
        <div class="panel">
          <h2>LLM Traces</h2>
          <p class="metric" id="trace-count">0</p>
          <p class="summary-line" id="trace-summary">No traced LLM calls.</p>
        </div>
        <div class="panel">
          <h2>Provider Calls</h2>
          <p class="metric" id="provider-call-count">0</p>
          <p class="summary-line" id="provider-call-summary">No provider calls.</p>
        </div>
      </div>
      <div class="grid two-column">
        <div class="panel">
          <h2>Providers</h2>
          <p class="summary-line" id="provider-summary">Loading providers.</p>
          <table>
            <thead><tr><th>Role</th><th>Provider</th><th>Required Env</th></tr></thead>
            <tbody id="providers"></tbody>
          </table>
        </div>
        <div class="panel">
          <h2>Runtime Config</h2>
          <p class="summary-line" id="config-summary">Loading config.</p>
          <table>
            <thead><tr><th>Key</th><th>Value</th></tr></thead>
            <tbody id="config"></tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <h2>Controlled Operations</h2>
        <p class="summary-line">Studio opens in read-only review mode. Enable project operations before rerun, render, or export.</p>
        <div class="actions">
          <label class="operation-toggle">
            <input id="operations-enabled" type="checkbox">
            Enable project operations
          </label>
          <button id="render-action" type="button">Render</button>
          <button id="export-action" type="button">Export</button>
          <span class="action-group">
            <select id="rerun-stage" aria-label="Rerun from stage"></select>
            <button id="rerun-action" type="button">Rerun</button>
          </span>
          <button id="worker-action" type="button">Worker dry-run</button>
          <button id="provider-test-action" type="button">Provider test</button>
        </div>
        <p class="status-line" id="operation-lock-status">Rerun, render, and export are disabled.</p>
        <div class="control-grid">
          <label class="control">Subtitles
            <input id="render-subtitles" type="checkbox" checked>
          </label>
          <label class="control">Audio
            <input id="render-audio" type="checkbox" checked>
          </label>
          <label class="control">Ducking
            <input id="render-audio-ducking" type="checkbox">
          </label>
          <label class="control">Source volume
            <input id="render-source-volume" inputmode="decimal" placeholder="1">
          </label>
          <label class="control">Voiceover volume
            <input id="render-voiceover-volume" inputmode="decimal" placeholder="1">
          </label>
          <label class="control">Export format
            <select id="export-format">
              <option value="">auto</option>
              <option value="video">video</option>
              <option value="bundle">bundle</option>
            </select>
          </label>
          <label class="control">Export output
            <input id="export-output" placeholder="./final.mp4">
          </label>
          <label class="control">Require quality
            <input id="export-require-quality" type="checkbox" checked>
          </label>
          <label class="control">Clean directory
            <input id="export-clean-output" type="checkbox">
          </label>
        </div>
        <p class="status-line" id="action-status"></p>
      </div>
      <div class="panel">
        <h2>Guided Actions</h2>
        <table>
          <thead><tr><th>Action</th><th>Category</th><th>Description</th><th>Command</th><th></th></tr></thead>
          <tbody id="guided-actions"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Pipeline</h2>
        <table>
          <thead><tr><th>Stage</th><th>Status</th><th>Attempt</th></tr></thead>
          <tbody id="stages"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Artifacts</h2>
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Size</th><th></th></tr></thead>
          <tbody id="artifacts"></tbody>
        </table>
        <pre class="preview" id="artifact-preview">Select an artifact to preview.</pre>
      </div>
      <div class="panel">
        <h2>Render Result</h2>
        <p class="summary-line" id="render-result-summary">No rendered output.</p>
        <div class="actions" id="render-result-actions"></div>
        <video class="render-player" id="render-result-player" controls preload="metadata"></video>
      </div>
      <div class="panel">
        <h2>Keyframes</h2>
        <div class="sample-grid" id="visual-samples"></div>
      </div>
      <div class="panel">
        <h2>Quality Issues</h2>
        <p class="summary-line" id="quality-issue-summary">No quality issues.</p>
        <table>
          <thead><tr><th>Area</th><th>Severity</th><th>Code</th><th>Message</th></tr></thead>
          <tbody id="quality-issues"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>LLM Traces</h2>
        <table>
          <thead><tr><th>Status</th><th>Operation</th><th>Provider</th><th>Model</th><th>Usage</th><th>Latency</th><th>Request</th></tr></thead>
          <tbody id="llm-traces"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Deck Review</h2>
        <p class="summary-line" id="deck-review-summary">No deck review.</p>
        <div class="actions" id="deck-review-actions"></div>
      </div>
      <div class="panel">
        <h2>Template Quality</h2>
        <p class="summary-line" id="template-summary">No template quality report.</p>
        <table>
          <thead><tr><th>Severity</th><th>Code</th><th>Message</th></tr></thead>
          <tbody id="template-issues"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Render Quality</h2>
        <p class="summary-line" id="render-quality-summary">No render quality report.</p>
        <table>
          <thead><tr><th>Area</th><th>Severity</th><th>Code</th><th>Message</th></tr></thead>
          <tbody id="render-quality-issues"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Artifact Integrity</h2>
        <p class="summary-line" id="artifact-integrity-summary">No artifact integrity report.</p>
        <table>
          <thead><tr><th>Status</th><th>Name</th><th>Detail</th></tr></thead>
          <tbody id="artifact-integrity-issues"></tbody>
        </table>
      </div>
      <div class="panel">
        <h2>Recent Events</h2>
        <table>
          <thead><tr><th>Time</th><th>Kind</th><th>Detail</th></tr></thead>
          <tbody id="events"></tbody>
        </table>
      </div>
    </section>
  </main>
  <script type="module">
${STUDIO_CLIENT_SCRIPT}
  </script>
</body>
</html>`
}

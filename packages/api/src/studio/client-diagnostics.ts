export const STUDIO_CLIENT_DIAGNOSTICS_SCRIPT = String.raw`    const artifactRow = (artifact) => {
      const row = tableRow([artifact.name, artifact.kind, artifact.size]);
      const actionCell = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Preview";
      button.addEventListener("click", () => void previewArtifact(artifact.name));
      actionCell.append(button);
      row.append(actionCell);
      return row;
    };
    const formatPreview = (value) => typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const previewArtifact = async (name) => {
      byId("artifact-preview").textContent = "Loading " + name + "...";
      try {
        const artifact = await api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts/" + encodeURIComponent(name));
        byId("artifact-preview").textContent = formatPreview(artifact.content);
      } catch (error) {
        byId("artifact-preview").textContent = error instanceof Error ? error.message : String(error);
      }
    };
    const renderVisualSamples = (samples) => {
      const target = byId("visual-samples");
      target.textContent = "";
      if (samples.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No keyframes";
        target.append(empty);
        return;
      }
      for (const sample of samples) {
        const card = document.createElement("div");
        card.className = "sample" + (sample.ok ? "" : " sample--warning");
        if (sample.exists && sample.contentBase64 !== undefined) {
          const image = document.createElement("img");
          image.alt = "Keyframe at " + sample.timestamp + "s";
          image.src = "data:image/jpeg;base64," + sample.contentBase64;
          card.append(image);
        } else {
          const missing = document.createElement("div");
          missing.className = "sample-missing";
          missing.textContent = sample.error ?? "Keyframe unavailable";
          card.append(missing);
        }
        const meta = document.createElement("p");
        meta.className = "muted";
        meta.textContent = sample.timestamp + "s " + (sample.relativePath ?? sample.path ?? "") + (sample.size === undefined ? "" : " · " + sample.size + " bytes");
        card.append(meta);
        target.append(card);
      }
    };
    const renderRenderResult = (render) => {
      const summary = byId("render-result-summary");
      const actions = byId("render-result-actions");
      const player = byId("render-result-player");
      actions.textContent = "";
      player.removeAttribute("src");
      player.load();
      if (render?.rendered !== true || render.output === undefined) {
        summary.textContent = "No rendered output.";
        player.hidden = true;
        return;
      }
      const url = projectFileUrl(render.output);
      summary.textContent = render.output;
      player.hidden = false;
      player.src = url;
      const open = document.createElement("a");
      open.href = url;
      open.target = "_blank";
      open.rel = "noreferrer";
      open.textContent = "Open video";
      const download = document.createElement("a");
      download.href = url;
      download.download = render.output.split("/").pop() || "render.mp4";
      download.textContent = "Download";
      actions.append(open, download);
    };
    const renderDeckReview = (status) => {
      const summary = byId("deck-review-summary");
      const actions = byId("deck-review-actions");
      const render = status?.summary?.render;
      actions.textContent = "";
      if (render?.reviewAvailable !== true) {
        summary.textContent = "No deck review.";
        return;
      }
      summary.textContent = "Review available: " + render.reviewHtml + " | " + render.reviewReport;
      if (render.reviewHtml !== undefined) {
        const link = document.createElement("a");
        link.href = projectFileUrl(render.reviewHtml);
        link.target = "_blank";
        link.rel = "noreferrer";
        link.textContent = "Open review";
        actions.append(link);
      }
      if (render.reviewReport !== undefined) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Preview report";
        button.addEventListener("click", () => void previewArtifact(render.reviewReport.replace(/^artifacts\//, "")));
        actions.append(button);
      }
    };
    const severityBadge = (severity) => {
      const badge = document.createElement("span");
      badge.className = "severity severity--" + severity;
      badge.textContent = severity;
      return badge;
    };
    const issueRow = (issue) => {
      const row = document.createElement("tr");
      const severity = document.createElement("td");
      severity.append(severityBadge(issue.severity ?? "warning"));
      const code = document.createElement("td");
      code.textContent = text(issue.code);
      const message = document.createElement("td");
      message.textContent = text(issue.message);
      row.append(severity, code, message);
      return row;
    };
    const qualityIssueRow = (area, issue) => {
      const row = document.createElement("tr");
      const areaCell = document.createElement("td");
      areaCell.textContent = area;
      const severity = document.createElement("td");
      severity.append(severityBadge(issue.severity ?? "warning"));
      const code = document.createElement("td");
      code.textContent = text(issue.code);
      const message = document.createElement("td");
      message.textContent = text(issue.message);
      row.append(areaCell, severity, code, message);
      return row;
    };
    const qualityCount = (quality) => quality === undefined ? "not checked" : quality.errors + " errors, " + quality.warnings + " warnings";
    const renderQualityRows = (renderOutput) => {
      const sections = [
        ["Output", renderOutput?.outputQuality],
        ["Audio", renderOutput?.audioQuality],
        ["Subtitles", renderOutput?.subtitleQuality],
        ["Visual", renderOutput?.visualQuality],
      ];
      const rows = sections.flatMap(([area, quality]) => Array.isArray(quality?.issues) ? quality.issues.map((issue) => qualityIssueRow(area, issue)) : []);
      for (const warning of renderOutput?.audioDiagnostics?.warnings ?? []) {
        rows.push(qualityIssueRow("Audio", {code: "audio.diagnostic.warning", message: warning, severity: "warning"}));
      }
      for (const missing of renderOutput?.audioDiagnostics?.missingVoiceovers ?? []) {
        rows.push(qualityIssueRow("Audio", {code: "audio.voiceover.missing", message: "Missing voiceover " + text(missing.narrationId ?? missing.index), severity: "warning"}));
      }
      return rows;
    };
    const renderRenderQuality = (renderOutput) => {
      if (renderOutput === undefined) {
        byId("render-quality-summary").textContent = "No render quality report.";
        setRows("render-quality-issues", [], 4);
        return;
      }
      byId("render-quality-summary").textContent = [
        "output " + qualityCount(renderOutput.outputQuality),
        "audio " + qualityCount(renderOutput.audioQuality),
        "subtitles " + qualityCount(renderOutput.subtitleQuality),
        "visual " + qualityCount(renderOutput.visualQuality),
      ].join(" | ");
      setRows("render-quality-issues", renderQualityRows(renderOutput), 4);
    };
    const qualityDetailRows = (quality) => {
      const rows = [];
      for (const issue of quality?.contentIssues ?? []) {
        rows.push(qualityIssueRow("Content", issue));
      }
      for (const issue of quality?.deckIssues ?? []) {
        rows.push(qualityIssueRow("Deck", issue));
      }
      for (const issue of quality?.qualityReport?.issues ?? []) {
        rows.push(qualityIssueRow("Pipeline", issue));
      }
      return rows;
    };
    const renderQualityDetails = (quality) => {
      if (quality === undefined) {
        byId("quality-issue-summary").textContent = "No quality details.";
        setRows("quality-issues", [], 4);
        return;
      }
      byId("quality-issue-summary").textContent = [
        "project " + quality.summary.errors + " errors, " + quality.summary.warnings + " warnings",
        "content " + quality.content.errors + "/" + quality.content.warnings,
        "deck " + quality.deck.errors + "/" + quality.deck.warnings,
      ].join(" | ");
      setRows("quality-issues", qualityDetailRows(quality), 4);
    };
    const renderTemplateQuality = (renderOutput) => {
      const quality = renderOutput?.templateQuality;
      if (quality === undefined) {
        byId("template-summary").textContent = "No template quality report.";
        setRows("template-issues", [], 3);
        return;
      }
      byId("template-summary").textContent = (quality.ok ? "ok" : "needs attention") + " - " + quality.errors + " errors, " + quality.warnings + " warnings";
      setRows("template-issues", Array.isArray(quality.issues) ? quality.issues.map((issue) => issueRow(issue)) : [], 3);
    };
    const loadRenderDiagnostics = async (artifacts) => {
      if (!artifacts.some((artifact) => artifact.name === "render-output.json")) {
        renderTemplateQuality(undefined);
        renderRenderQuality(undefined);
        return;
      }
      try {
        const renderOutput = await api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts/render-output.json");
        renderTemplateQuality(renderOutput.content);
        renderRenderQuality(renderOutput.content);
      } catch {
        renderTemplateQuality(undefined);
        renderRenderQuality(undefined);
      }
    };
    const integrityRow = (status, name, detail) => {
      const row = document.createElement("tr");
      const statusCell = document.createElement("td");
      statusCell.textContent = status;
      const nameCell = document.createElement("td");
      nameCell.textContent = text(name);
      const detailCell = document.createElement("td");
      detailCell.textContent = text(detail);
      row.append(statusCell, nameCell, detailCell);
      return row;
    };
    const renderArtifactIntegrity = (integrity) => {
      if (integrity === undefined) {
        byId("artifact-integrity-summary").textContent = "No artifact integrity report.";
        setRows("artifact-integrity-issues", [], 3);
        return;
      }
      const summary = integrity.summary ?? {
        changed: integrity.changed.length,
        checked: integrity.checked,
        errors: integrity.changed.length + integrity.missing.length + (integrity.schemaInvalid ?? []).length,
        missing: integrity.missing.length,
        schemaInvalid: (integrity.schemaInvalid ?? []).length,
        untracked: integrity.untracked.length,
        warnings: integrity.untracked.length,
      };
      byId("artifact-integrity-summary").textContent = (integrity.ok ? "ok" : "needs attention") + " - " + summary.errors + " errors, " + summary.warnings + " warnings, " + summary.checked + " checked";
      setRows("artifact-integrity-issues", [
        ...integrity.missing.map((issue) => integrityRow("missing", issue.name, issue.reason)),
        ...integrity.changed.map((issue) => integrityRow("changed", issue.name, "size " + issue.expectedSize + " -> " + issue.actualSize)),
        ...(integrity.schemaInvalid ?? []).map((issue) => integrityRow("schema invalid", issue.name, issue.issues.map((schemaIssue) => (schemaIssue.path.join(".") || "<root>") + ": " + schemaIssue.message).join("; "))),
        ...integrity.untracked.map((name) => integrityRow("untracked", name, "not present in artifact-manifest.json")),
      ], 3);
    };
    const traceRow = (trace) => tableRow([
      trace.status,
      trace.operation,
      trace.provider ?? "unknown",
      trace.model ?? "unknown",
      formatUsage(trace.usage),
      trace.durationMs + "ms",
      trace.requestId,
    ]);
    const renderLLMTraces = (report) => {
      const traces = report?.llmTraces ?? [];
      const failed = traces.filter((trace) => trace.status === "failed").length;
      const usage = report?.summary?.llm?.usage;
      byId("trace-count").textContent = String(traces.length);
      byId("trace-summary").textContent = traces.length + " traces, " + failed + " failed, " + formatUsage(usage);
      byId("provider-call-count").textContent = String(report?.summary?.total ?? 0);
      byId("provider-call-summary").textContent = (report?.summary?.failed ?? 0) + " failed, " + formatUsage(report?.summary?.usage);
      setRows("llm-traces", traces.slice(0, 30).map((trace) => traceRow(trace)), 7);
    };`

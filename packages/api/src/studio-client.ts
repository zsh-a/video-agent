import {STUDIO_CLIENT_API_SCRIPT} from './studio-client-api.js'
import {STUDIO_CLIENT_DIAGNOSTICS_SCRIPT} from './studio-client-diagnostics.js'

export const STUDIO_CLIENT_SCRIPT = [STUDIO_CLIENT_API_SCRIPT, String.raw`
    const renderProviderEnvironment = (report) => {
      const summary = report.summary ?? {
        configured: report.providers.reduce((count, provider) => count + provider.requirements.filter((requirement) => requirement.configured).length, 0),
        missingRequired: report.providers.flatMap((provider) => provider.requirements.filter((requirement) => requirement.required && !requirement.configured).map((requirement) => requirement.env)),
        total: report.providers.reduce((count, provider) => count + provider.requirements.length, 0),
      };
      byId("provider-summary").textContent = summary.configured + "/" + summary.total + " env configured, " + summary.missingRequired.length + " required missing";
      setRows("providers", report.providers.map((provider) => tableRow([
        provider.role,
        provider.provider,
        provider.requirements.filter((requirement) => requirement.required).map((requirement) => requirement.env + "=" + (requirement.configured ? "set" : "missing")).join(", ") || "none",
      ])), 3);
    };
    const renderConfig = (config) => {
      byId("config-summary").textContent = "job store " + config.persistence.jobStore + " | retries " + config.pipeline.maxStageRetries;
      setRows("config", [
        tableRow(["providers.asr", config.providers.asr]),
        tableRow(["providers.vlm", config.providers.vlm]),
        tableRow(["providers.tts", config.providers.tts]),
        tableRow(["persistence.jobStore", config.persistence.jobStore]),
        tableRow(["pipeline.maxStageRetries", config.pipeline.maxStageRetries]),
        tableRow(["pipeline.retryBackoffMs", config.pipeline.retryBackoffMs]),
      ], 2);
    };
    `, STUDIO_CLIENT_DIAGNOSTICS_SCRIPT, String.raw`
    const guidedActionRow = (action) => {
      const row = tableRow([action.label, action.category, action.description, action.command]);
      const actionCell = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Copy";
      button.addEventListener("click", () => void copyGuidedAction(action.command));
      actionCell.append(button);
      row.append(actionCell);
      return row;
    };
    const renderGuidedActions = (actions) => {
      setRows("guided-actions", actions.map((action) => guidedActionRow(action)), 5);
    };
    const copyGuidedAction = async (command) => {
      try {
        if (navigator.clipboard === undefined) {
          throw new Error("Clipboard API is unavailable.");
        }
        await navigator.clipboard.writeText(command);
        byId("action-status").textContent = "Copied: " + command;
      } catch (error) {
        byId("action-status").textContent = "Copy failed: " + (error instanceof Error ? error.message : String(error));
      }
    };
    const loadGuidedActions = async () => {
      const path = state.projectId === undefined ? "/actions" : "/projects/" + encodeURIComponent(state.projectId) + "/actions";
      try {
        const result = await api(path);
        renderGuidedActions(result.actions);
      } catch {
        renderGuidedActions([]);
      }
    };
    const loadArtifactIntegrity = async () => {
      try {
        renderArtifactIntegrity(await api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts/verify"));
      } catch {
        renderArtifactIntegrity(undefined);
      }
    };
    const defaultRerunStage = (stages) => {
      const resumable = stages.find((stage) => ["failed", "running", "pending"].includes(stage.status));
      return (resumable ?? stages[0])?.name ?? "";
    };
    const renderRerunStages = (stages) => {
      const select = byId("rerun-stage");
      const previous = select.value;
      const fallback = defaultRerunStage(stages);
      select.textContent = "";
      for (const stage of stages) {
        const option = document.createElement("option");
        option.value = stage.name;
        option.textContent = stage.name + " (" + stage.status + ")";
        select.append(option);
      }
      select.value = stages.some((stage) => stage.name === previous) ? previous : fallback;
      select.disabled = stages.length === 0;
    };
    const renderProjects = (projects) => {
      const list = byId("projects");
      list.textContent = "";
      if (projects.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No projects";
        list.append(empty);
        return;
      }
      if (state.projectId === undefined) state.projectId = projects[0].projectId;
      for (const project of projects) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-pressed", String(project.projectId === state.projectId));
        button.addEventListener("click", () => {
          state.projectId = project.projectId;
          void load();
        });
        const name = document.createElement("strong");
        name.textContent = project.projectId;
        const meta = document.createElement("span");
        meta.className = "muted";
        meta.textContent = project.status + " " + project.updatedAt;
        button.append(name, meta);
        list.append(button);
      }
    };
    const renderSelected = async () => {
      const actionButtons = [byId("render-action"), byId("export-action"), byId("rerun-action"), byId("worker-action")];
      if (state.projectId === undefined) {
        byId("status").textContent = "none";
        byId("quality").textContent = "none";
        byId("render").textContent = "none";
        byId("action-status").textContent = "Select a project to run actions.";
        actionButtons.forEach((button) => { button.disabled = true; });
        renderRerunStages([]);
        setRows("stages", [], 3);
        setRows("artifacts", [], 4);
        setRows("events", [], 3);
        byId("artifact-preview").textContent = "Select an artifact to preview.";
        renderVisualSamples([]);
        renderDeckReview(undefined);
        renderTemplateQuality(undefined);
        renderRenderQuality(undefined);
        renderArtifactIntegrity(undefined);
        await loadGuidedActions();
        return;
      }
      actionButtons.forEach((button) => { button.disabled = false; });
      const [status, artifacts, events] = await Promise.all([
        api("/projects/" + encodeURIComponent(state.projectId) + "/status"),
        api("/projects/" + encodeURIComponent(state.projectId) + "/artifacts"),
        api("/projects/" + encodeURIComponent(state.projectId) + "/events?limit=8"),
      ]);
      byId("status").textContent = status.job.status;
      byId("quality").textContent = status.summary.quality.issues + " issues";
      byId("render").textContent = status.summary.render.rendered ? "rendered" : "none";
      renderDeckReview(status);
      renderRerunStages(status.job.stages);
      setRows("stages", status.job.stages.map((stage) => tableRow([stage.name, stage.status, stage.attempt ?? ""])), 3);
      setRows("artifacts", artifacts.artifacts.slice(0, 12).map((artifact) => artifactRow(artifact)), 4);
      setRows("events", events.events.map((event) => tableRow([event.time, event.kind, event.event.type ?? event.event.operation ?? ""])), 3);
      byId("artifact-preview").textContent = "Select an artifact to preview.";
      await Promise.all([
        loadRenderDiagnostics(artifacts.artifacts),
        loadArtifactIntegrity(),
        loadGuidedActions(),
      ]);
      try {
        const visual = await api("/projects/" + encodeURIComponent(state.projectId) + "/visual?includeContent=true");
        renderVisualSamples(visual.samples);
      } catch {
        renderVisualSamples([]);
      }
    };
    const runAction = async (label, action) => {
      if (state.projectId === undefined) return;
      byId("action-status").textContent = label + " running...";
      try {
        const result = await action();
        byId("action-status").textContent = label + " complete: " + JSON.stringify(result);
        await load();
      } catch (error) {
        byId("action-status").textContent = label + " failed: " + (error instanceof Error ? error.message : String(error));
      }
    };
    const runWorkspaceAction = async (label, action) => {
      byId("action-status").textContent = label + " running...";
      try {
        const result = await action();
        byId("action-status").textContent = label + " complete: " + JSON.stringify(result);
        await load();
      } catch (error) {
        byId("action-status").textContent = label + " failed: " + (error instanceof Error ? error.message : String(error));
      }
    };
    const load = async () => {
      const [health, providerEnv, config, projects] = await Promise.all([
        api("/health"),
        api("/provider-env"),
        api("/config"),
        api("/projects"),
      ]);
      byId("workspace").textContent = health.workspaceDir;
      byId("workspace-summary").textContent = health.workspaceDir;
      renderProviderEnvironment(providerEnv);
      renderConfig(config);
      renderProjects(projects.projects);
      await renderSelected();
    };
    byId("refresh").addEventListener("click", () => void load());
    byId("render-action").addEventListener("click", () => void runAction("Render", () => api("/projects/" + encodeURIComponent(state.projectId) + "/render", {
      body: JSON.stringify(readRenderOptions()),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("export-action").addEventListener("click", () => void runAction("Export", () => api("/projects/" + encodeURIComponent(state.projectId) + "/export", {
      body: JSON.stringify(readExportOptions()),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("rerun-action").addEventListener("click", () => void runAction("Rerun", () => api("/projects/" + encodeURIComponent(state.projectId) + "/rerun", {
      body: JSON.stringify({fromStage: byId("rerun-stage").value || undefined}),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("worker-action").addEventListener("click", () => void runAction("Worker dry-run", () => api("/worker", {
      body: JSON.stringify({dryRun: true, orderBy: "oldest", runningStaleAfterMs: 60000, status: "active"}),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    byId("provider-test-action").addEventListener("click", () => void runWorkspaceAction("Provider test", () => api("/provider-test", {
      body: JSON.stringify({role: "all"}),
      headers: {"content-type": "application/json"},
      method: "POST",
    })));
    void load();`].join("\n")

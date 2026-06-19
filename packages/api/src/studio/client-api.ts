export const STUDIO_CLIENT_API_SCRIPT = String.raw`    const state = {projectId: undefined};
    const byId = (id) => document.getElementById(id);
    const listText = (items) => Array.isArray(items) && items.length > 0 ? items.join(", ") : "none";
    const formatApiError = (status, error, fallback) => {
      if (error?.code === "checkpoint_invalid") {
        return [
          "HTTP " + status + " checkpoint_invalid: " + (error.message ?? "Checkpoint artifacts are invalid."),
          "missing: " + listText(error.missingArtifacts),
          "changed: " + listText(error.changedArtifacts),
          "schema invalid: " + listText(error.schemaInvalidArtifacts),
          "untracked: " + listText(error.untrackedArtifacts),
        ].join(" | ");
      }
      if (error?.code === "export_quality_failed") {
        const quality = error.quality?.summary;
        const qualityText = quality === undefined ? "quality report unavailable" : quality.errors + " errors, " + quality.warnings + " warnings";
        return "HTTP " + status + " export_quality_failed: " + qualityText + " - " + (error.message ?? "Project quality gate failed.");
      }
      if (error?.code === "validation_error") {
        const issues = Array.isArray(error.issues) ? error.issues.map((issue) => (issue.path ?? []).join(".") + ": " + issue.message).join("; ") : "no issue details";
        return "HTTP " + status + " validation_error: " + issues;
      }
      return "HTTP " + status + ": " + (error?.message ?? fallback);
    };
    const createApiError = async (response) => {
      const bodyText = await response.text();
      let body;
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = undefined;
      }
      const error = body?.error;
      const result = new Error(formatApiError(response.status, error, bodyText));
      result.status = response.status;
      result.body = body;
      result.apiError = error;
      return result;
    };
    const api = async (path, options = {}) => {
      const response = await fetch(path, options);
      if (!response.ok) throw await createApiError(response);
      return response.json();
    };
    const projectFileUrl = (path) => "/projects/" + encodeURIComponent(state.projectId) + "/files?path=" + encodeURIComponent(path);
    const text = (value) => value === undefined || value === null ? "" : String(value);
    const setRows = (id, rows, emptyCells) => {
      const target = byId(id);
      target.textContent = "";
      if (rows.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = emptyCells;
        cell.className = "muted";
        cell.textContent = "None";
        row.append(cell);
        target.append(row);
        return;
      }
      target.append(...rows);
    };
    const tableRow = (values) => {
      const row = document.createElement("tr");
      for (const value of values) {
        const cell = document.createElement("td");
        cell.textContent = text(value);
        row.append(cell);
      }
      return row;
    };
    const optionalNumber = (id) => {
      const value = byId(id).value.trim();
      if (value === "") return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) throw new Error(id + " must be a number.");
      return parsed;
    };
    const optionalString = (id) => {
      const value = byId(id).value.trim();
      return value === "" ? undefined : value;
    };
    const optionalStringArray = (id) => {
      const value = optionalString(id);
      if (value === undefined) return undefined;
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
        throw new Error(id + " must be a JSON string array.");
      }
      return parsed;
    };
    const maybe = (object, key, value) => {
      if (value !== undefined) object[key] = value;
    };
    const readRenderOptions = () => {
      const options = {
        audio: byId("render-audio").checked,
        audioDucking: byId("render-audio-ducking").checked,
        subtitles: byId("render-subtitles").checked,
      };
      maybe(options, "sourceVolume", optionalNumber("render-source-volume"));
      maybe(options, "voiceoverVolume", optionalNumber("render-voiceover-volume"));
      return options;
    };
    const readExportOptions = () => {
      const options = {
        cleanOutput: byId("export-clean-output").checked,
        requireQuality: byId("export-require-quality").checked,
      };
      maybe(options, "format", optionalString("export-format"));
      maybe(options, "outputPath", optionalString("export-output"));
      return options;
    };`

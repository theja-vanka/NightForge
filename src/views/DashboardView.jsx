import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { SummaryCard } from "../components/SummaryCard.jsx";
import { TrainingPanel } from "../components/TrainingPanel.jsx";
import { SystemMetricsPanel, GpuMetricsPanel } from "../components/SystemMetricsPanel.jsx";
import SyncLogsPanel from "../components/SyncLogsPanel.jsx";
import {
  stats,
  sshInfo,
  toggleSshConnection,
  sshConnecting,
  sshConnected,
  sshConnectionError,
  clearSshConnectionError,
  dashboardSynced,
  dashboardSyncing,
  syncDashboard,
  syncProgress,
  syncShowingCompletion,
  syncLogs,
  datasetPathStatus,
  datasetValidation,
  condaInfo,
  uvInfo,
  envInfo,
  syncConfig,
  platform,
} from "../state/dashboard.js";
import { currentProject } from "../state/projects.js";
import { startTraining, trainingActive } from "../state/training.js";
import { projectRuns } from "../state/experiments.js";
import { addToQueue, projectQueue, removeFromQueue, queueLength } from "../state/queue.js";

function SshStatusBanner() {
  const info = sshInfo.value;
  const connecting = sshConnecting.value;
  if (!info) return null;

  const elapsed = info.connectedAt
    ? Math.floor((Date.now() - new Date(info.connectedAt).getTime()) / 60000)
    : 0;
  const uptime =
    elapsed >= 60
      ? `${Math.floor(elapsed / 60)}h ${elapsed % 60}m`
      : `${elapsed}m`;

  const bannerClass = `ssh-status-banner ${connecting
    ? "ssh-connecting"
    : info.connected
      ? "ssh-connected"
      : "ssh-disconnected"
    }`;
  const statusLabel = connecting
    ? "Connecting..."
    : info.connected
      ? "Connected"
      : "Disconnected";
  const buttonLabel = connecting
    ? "Connecting..."
    : info.connected
      ? "Disconnect"
      : "Connect";

  return (
    <div class={bannerClass}>
      {connecting ? (
        <div class="ssh-status-spinner" />
      ) : (
        <div class="ssh-status-dot" />
      )}
      <div class="ssh-status-info">
        <span class="ssh-status-label">{statusLabel}</span>
        <span class="ssh-status-host">{info.host}</span>
      </div>
      {info.connected && !connecting && (
        <span class="ssh-status-uptime">
          Uptime: {uptime}
          {info.lastActivity && (() => {
            const idle = Math.floor((Date.now() - new Date(info.lastActivity).getTime()) / 60000);
            return idle >= 1 ? ` · Idle: ${idle >= 60 ? `${Math.floor(idle / 60)}h ${idle % 60}m` : `${idle}m`}` : null;
          })()}
        </span>
      )}
      <button
        class={`ssh-toggle-btn ${info.connected ? "ssh-toggle-disconnect" : ""}`}
        onClick={toggleSshConnection}
        disabled={connecting}
      >
        {connecting && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="ssh-btn-spinner"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        )}
        {buttonLabel}
      </button>
    </div>
  );
}

const icons = {
  total: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>`,
  running: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  accuracy: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>`,
  testAccuracy: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
};

function SshErrorModal() {
  const error = sshConnectionError.value;
  if (!error) return null;

  return (
    <div class="modal-overlay" onClick={() => clearSshConnectionError()}>
      <div
        class="modal-dialog ssh-error-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="modal-header">
          <h3 class="modal-title">SSH Connection Failed</h3>
          <button
            class="modal-close-btn"
            onClick={() => clearSshConnectionError()}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="ssh-error-icon">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <p class="ssh-error-message">{error.message}</p>
          {error.message && (
            <p class="ssh-error-hint" style="color:var(--text-muted);font-size:0.82rem;margin-top:8px">
              {/timed?\s*out|timeout/i.test(error.message)
                ? "Check that the host is reachable and the SSH port (default 22) is open."
                : /refused/i.test(error.message)
                  ? "The remote machine actively refused the connection. Verify sshd is running."
                  : /permission|auth|denied|publickey/i.test(error.message)
                    ? "Authentication failed. Check your SSH key or credentials in the project settings."
                    : /resolve|unknown host|no such host/i.test(error.message)
                      ? "Could not resolve the hostname. Verify the address in project settings."
                      : "Check the SSH command in project settings and ensure the remote machine is accessible."}
            </p>
          )}
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-primary"
            onClick={() => clearSshConnectionError()}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function DatasetStatusBanner() {
  const project = currentProject.value;
  const status = datasetPathStatus.value;
  const validation = datasetValidation.value;
  if (!project) return null;

  const fmt = project.datasetFormat;
  const usesSplitFiles = fmt === "CSV" || fmt === "JSONL";

  const paths = [];
  if (usesSplitFiles) {
    if (project.trainPath)
      paths.push({
        label: "Train",
        path: project.trainPath,
        exists: status.trainPath,
      });
    if (project.valPath)
      paths.push({
        label: "Validation",
        path: project.valPath,
        exists: status.valPath,
      });
    if (project.testPath)
      paths.push({
        label: "Test",
        path: project.testPath,
        exists: status.testPath,
      });
  } else {
    if (project.folderPath)
      paths.push({
        label: "Dataset Folder",
        path: project.folderPath,
        exists: status.folderPath,
      });
  }

  if (paths.length === 0) return null;

  // Determine overall structure status for the folder path row
  const structureValid = validation?.valid;
  const structureErrors = validation?.errors || [];
  const structureWarnings = validation?.warnings || [];
  const structureInfo = validation?.info || {};

  // Build info chips from validation stats
  const infoChips = [];
  if (structureInfo.classes) infoChips.push(`${structureInfo.classes} classes`);
  if (structureInfo.images) infoChips.push(`${structureInfo.images} images`);
  if (structureInfo.masks) infoChips.push(`${structureInfo.masks} masks`);
  if (structureInfo.categories) infoChips.push(`${structureInfo.categories} categories`);
  if (structureInfo.splits) infoChips.push(`splits: ${structureInfo.splits}`);

  return (
    <div class="dataset-status-banner">
      <div class="dataset-status-header">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span>Dataset Paths</span>
      </div>
      <div class="dataset-status-items">
        {paths.map((p) => (
          <div class="dataset-status-item" key={p.label}>
            <span
              class={`dataset-status-dot ${p.exists === true ? "found" : p.exists === false ? "missing" : "unknown"}`}
            />
            <span class="dataset-status-label">{p.label}</span>
            <span class="dataset-status-path">{p.path}</span>
            <span
              class={`dataset-status-tag ${p.exists === true ? "found" : p.exists === false ? "missing" : "unknown"}`}
            >
              {p.exists === true
                ? "Found"
                : p.exists === false
                  ? "Not Found"
                  : "—"}
            </span>
          </div>
        ))}
        {validation && !usesSplitFiles && (
          <div class={`dataset-status-item ${structureValid ? "" : "dataset-status-item--invalid"}`}>
            <span
              class={`dataset-status-dot ${structureValid ? "found" : "missing"}`}
            />
            <span class="dataset-status-label">Structure</span>
            <span class="dataset-status-path">
              {structureValid
                ? infoChips.join(" · ") || "Valid"
                : structureErrors[0] || "Invalid structure"}
            </span>
            <span
              class={`dataset-status-tag ${structureValid ? "found" : "missing"}`}
            >
              {structureValid ? "Valid" : "Invalid"}
            </span>
          </div>
        )}
      </div>
      {!usesSplitFiles && structureErrors.length > 1 && (
        <div class="dataset-validation-details">
          {structureErrors.slice(1).map((e, i) => (
            <div key={`e${i}`} class="dataset-validation-line dataset-validation-error">{e}</div>
          ))}
        </div>
      )}
      {!usesSplitFiles && structureWarnings.length > 0 && (
        <div class="dataset-validation-details">
          {structureWarnings.map((w, i) => (
            <div key={`w${i}`} class="dataset-validation-line dataset-validation-warn">{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function EnvStatusBanner() {
  const conda = condaInfo.value;
  const uv = uvInfo.value;
  const info = envInfo.value;
  if (!conda && !uv && !info) return null;

  const isError = info?.status === "error";
  const dotClass = isError ? "missing" : "found";
  const tagClass = isError ? "missing" : "found";

  // Show conda if available, otherwise show uv
  const pkgManager = conda?.installed ? conda : uv;
  const pkgManagerLabel = conda?.installed ? "conda" : "uv";

  return (
    <div class="dataset-status-banner">
      <div class="dataset-status-header">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        <span>Python Environment</span>
      </div>
      <div class="dataset-status-items">
        {pkgManager && (
          <div class="dataset-status-item">
            <span
              class={`dataset-status-dot ${pkgManager.installed ? "found" : "missing"}`}
            />
            <span class="dataset-status-label">{pkgManagerLabel}</span>
            <span class="dataset-status-path">
              {pkgManager.installed
                ? pkgManager.version || "installed"
                : pkgManager.message}
            </span>
            <span
              class={`dataset-status-tag ${pkgManager.installed ? "found" : "missing"}`}
            >
              {pkgManager.installed ? "Ready" : "Missing"}
            </span>
          </div>
        )}
        {info &&
          (isError ? (
            <div class="dataset-status-item">
              <span class={`dataset-status-dot ${dotClass}`} />
              <span class="dataset-status-label">Status</span>
              <span class="dataset-status-path">{info.message}</span>
              <span class={`dataset-status-tag ${tagClass}`}>Error</span>
            </div>
          ) : (
            <>
              <div class="dataset-status-item">
                <span class={`dataset-status-dot ${dotClass}`} />
                <span class="dataset-status-label">Python</span>
                <span class="dataset-status-path">
                  {info.pythonVersion || "unknown"}
                </span>
                <span class={`dataset-status-tag ${tagClass}`}>
                  {info.status === "created"
                    ? "Installed"
                    : info.status === "system"
                      ? "System"
                      : "Ready"}
                </span>
              </div>
              <div class="dataset-status-item">
                <span
                  class={`dataset-status-dot ${info.autotimmVersion ? "found" : "missing"}`}
                />
                <span class="dataset-status-label">AutoTimm</span>
                <span class="dataset-status-path">
                  {info.autotimmVersion || "not installed"}
                </span>
                <span
                  class={`dataset-status-tag ${info.autotimmVersion ? "found" : "missing"}`}
                >
                  {info.autotimmVersion
                    ? info.status === "created"
                      ? "Installed"
                      : info.status === "system"
                        ? "System"
                        : "Ready"
                    : "Missing"}
                </span>
              </div>
            </>
          ))}
      </div>
    </div>
  );
}

function EnvironmentDropdown() {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef(null);

  return (
    <div class="env-dropdown">
      <button class="env-dropdown-toggle" onClick={() => setOpen(!open)}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>Dataset & Environment</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          class={`env-dropdown-chevron${open ? " env-dropdown-chevron--open" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div
        class={`env-dropdown-body${open ? " env-dropdown-body--open" : ""}`}
        ref={bodyRef}
        style={open && bodyRef.current ? { maxHeight: bodyRef.current.scrollHeight + "px" } : {}}
      >
        <div class="env-dropdown-inner">
          <DatasetStatusBanner />
          <EnvStatusBanner />
        </div>
      </div>
    </div>
  );
}

function ProgressCircle({ percentage }) {
  const circumference = 2 * Math.PI * 45; // radius = 45
  const dashOffset = circumference - (percentage / 100) * circumference;

  return (
    <div class="progress-circle-container">
      <svg
        width="80"
        height="80"
        viewBox="0 0 100 100"
        class="progress-circle-svg"
      >
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="var(--sync-progress-bg)"
          stroke-width="3"
        />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="var(--sync-progress-fill)"
          stroke-width="3"
          stroke-dasharray={circumference}
          stroke-dashoffset={dashOffset}
          stroke-linecap="round"
          class="progress-circle-svg-fill"
        />
      </svg>
      <span class="progress-circle-text">{Math.round(percentage)}%</span>
    </div>
  );
}

function SyncScreen() {
  const syncing = dashboardSyncing.value;
  const progress = syncProgress.value;
  const showingCompletion = syncShowingCompletion.value;
  const logs = syncLogs.value;
  const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

  return (
    <div class="dashboard-sync-screen">
      <div class="dashboard-sync-card">
        <div
          class={`dashboard-sync-icon${syncing ? " dashboard-sync-icon--spinning" : ""}`}
        >
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M23 4v6h-6" />
            <path d="M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </div>
        <h2 class="dashboard-sync-title">Sync Project Data</h2>
        <p class="dashboard-sync-desc">
          Scan the project directory for MLflow runs, parse metrics and
          checkpoints, and import them into the local database.
        </p>
        <button
          class="dashboard-sync-btn"
          onClick={syncDashboard}
          disabled={syncing || showingCompletion}
        >
          {syncing || showingCompletion ? (
            <ProgressCircle percentage={progress} />
          ) : (
            "Sync"
          )}
        </button>
        {(syncing || showingCompletion) && (
          <div class="sync-progress-section">
            <div class="sync-progress-bar-track">
              <div
                class="sync-progress-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            {latestLog && (
              <p class={`sync-progress-step sync-step-${latestLog.type}`}>
                {latestLog.message}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResyncButton() {
  const syncing = dashboardSyncing.value;
  return (
    <button
      class={`resync-fab${syncing ? " resync-fab--spinning" : ""}`}
      onClick={syncDashboard}
      disabled={syncing}
      title="Re-sync project data"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M23 4v6h-6" />
        <path d="M1 20v-6h6" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
      </svg>
    </button>
  );
}

// steps: "fit+test" (default), "fit", or "test"
function buildStepsCommand(project, steps = "fit+test") {
  const env = envInfo.value;
  const useVenv = env && (env.status === "exists" || env.status === "created");
  const isConda = useVenv && env.envType === "conda";
  const isWindows = project.connectionType !== "remote" && platform.value === "windows";
  const sep = isWindows ? "\\" : "/";
  const pp = (project.projectPath.endsWith("/") || project.projectPath.endsWith("\\"))
    ? project.projectPath.slice(0, -1)
    : project.projectPath;

  const cfg = `${pp}${sep}config.yaml`;

  if (isConda) {
    return `__STEPS_JSON__:${JSON.stringify({ mode: "conda", env_path: `${pp}${sep}.venv`, config_path: cfg, steps })}`;
  } else {
    const venvPython = isWindows
      ? `${pp}\\.venv\\Scripts\\python.exe`
      : `${pp}/.venv/bin/python`;
    const python = useVenv ? venvPython : (isWindows ? "python" : "python3");
    return `__STEPS_JSON__:${JSON.stringify({ mode: "direct", env_path: python, config_path: cfg, steps })}`;
  }
}

function buildTrainingCommand(project) {
  return buildStepsCommand(project, "fit+test");
}

function buildTestCommand(project) {
  return buildStepsCommand(project, "test");
}

// Human-readable version shown in the Power User command preview.
function buildCommandDisplay(project, steps = "fit+test") {
  const env = envInfo.value;
  const useVenv = env && (env.status === "exists" || env.status === "created");
  const isConda = useVenv && env.envType === "conda";
  const isWindows = project.connectionType !== "remote" && platform.value === "windows";
  const sep = isWindows ? "\\" : "/";
  const pp = (project.projectPath.endsWith("/") || project.projectPath.endsWith("\\"))
    ? project.projectPath.slice(0, -1)
    : project.projectPath;

  const cfg = `${pp}${sep}config.yaml`;

  const cmds = [];
  if (isConda) {
    const run = `conda run --live-stream -p ${pp}${sep}.venv python -m autotimm`;
    if (steps.includes("fit"))  cmds.push(`${run} fit  --config ${cfg}`);
    if (steps.includes("test")) cmds.push(`${run} test --config ${cfg}`);
  } else {
    const venvPy = isWindows
      ? `${pp}\\.venv\\Scripts\\python.exe`
      : `${pp}/.venv/bin/python`;
    const py = useVenv ? venvPy : (isWindows ? "python" : "python3");
    if (steps.includes("fit"))  cmds.push(`${py} -m autotimm fit  --config ${cfg}`);
    if (steps.includes("test")) cmds.push(`${py} -m autotimm test --config ${cfg}`);
  }
  return cmds.join(" &&\n");
}

function StartTrainingButton() {
  const project = currentProject.value;
  const active = trainingActive.value;
  if (!project) return null;

  const command = buildTrainingCommand(project);
  const testCommand = buildTestCommand(project);
  const commandDisplay = buildCommandDisplay(project);
  const testCommandDisplay = buildCommandDisplay(project, "test");
  const validation = datasetValidation.value;
  const datasetInvalid = validation && !validation.valid;

  const handleTrainClick = async () => {
    const runId = crypto.randomUUID();
    try {
      await syncConfig(project, project.id, runId);
      await startTraining(command, project.projectPath, runId, { projectId: project.id });
    } catch (error) { alert(`Could not start training: ${error.message || error}`); }
  };

  const handleTestClick = async () => {
    // Find the latest completed run to use its checkpoint
    const completed = projectRuns.value
      .filter((r) => r.status === "completed")
      .sort((a, b) => new Date(b.created) - new Date(a.created));
    const latestRun = completed[0];
    if (!latestRun) return;

    // Write config with the completed run's ID so autotimm test finds the checkpoint
    const runId = crypto.randomUUID();
    try {
      await syncConfig(project, project.id, latestRun.id);
      await startTraining(testCommand, project.projectPath, runId, { testOnly: true, projectId: project.id });
    } catch (error) { alert(`Could not start evaluation: ${error.message || error}`); }
  };

  return (
    <div class="start-training-section">
      <div class="start-training-illustration">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          {/* Exhaust glow */}
          <ellipse cx="32" cy="56" rx="8" ry="4" fill="var(--btn-bg)" opacity="0.08" />
          {/* Exhaust flames */}
          <path
            d="M29 46c-1 4-3 8-4 10"
            stroke="var(--text-muted)"
            stroke-width="1.5"
            stroke-linecap="round"
            opacity="0.5"
          />
          <path
            d="M32 46c0 4 0 9 0 12"
            stroke="var(--text-muted)"
            stroke-width="1.5"
            stroke-linecap="round"
            opacity="0.6"
          />
          <path
            d="M35 46c1 4 3 8 4 10"
            stroke="var(--text-muted)"
            stroke-width="1.5"
            stroke-linecap="round"
            opacity="0.5"
          />
          {/* Fins */}
          <path
            d="M24 40l-6 6h6z"
            fill="var(--btn-bg)"
            opacity="0.2"
            stroke="var(--btn-bg)"
            stroke-width="1"
            stroke-linejoin="round"
          />
          <path
            d="M40 40l6 6h-6z"
            fill="var(--btn-bg)"
            opacity="0.2"
            stroke="var(--btn-bg)"
            stroke-width="1"
            stroke-linejoin="round"
          />
          {/* Rocket body */}
          <path
            d="M32 6c-4 6-8 16-8 28v8h16v-8c0-12-4-22-8-28z"
            fill="var(--btn-bg)"
            opacity="0.1"
          />
          <path
            d="M32 6c-4 6-8 16-8 28v8h16v-8c0-12-4-22-8-28z"
            stroke="var(--btn-bg)"
            stroke-width="1.5"
            stroke-linejoin="round"
            fill="none"
          />
          {/* Nose highlight */}
          <path
            d="M32 10c-2 4-4.5 10-5.5 18"
            stroke="var(--btn-bg)"
            stroke-width="0.75"
            stroke-linecap="round"
            opacity="0.3"
          />
          {/* Window */}
          <circle cx="32" cy="26" r="4" stroke="var(--btn-bg)" stroke-width="1.5" fill="none" />
          <circle cx="32" cy="26" r="2.5" fill="var(--btn-bg)" opacity="0.15" />
          {/* Body stripe */}
          <line x1="24.5" y1="36" x2="39.5" y2="36" stroke="var(--btn-bg)" stroke-width="1" opacity="0.25" />
          <line x1="24" y1="38" x2="40" y2="38" stroke="var(--btn-bg)" stroke-width="1" opacity="0.25" />
        </svg>
      </div>
      <div class="start-training-label">Launch Experiment</div>
      {project.powerUserMode && (
        <div class="start-training-cmd-preview">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="start-training-cmd-icon"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span style="white-space: pre-wrap; word-break: break-word; min-width: 0;">{commandDisplay}</span>
        </div>
      )}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button
          class="start-training-btn"
          onClick={handleTrainClick}
          disabled={active || datasetInvalid}
          title={datasetInvalid ? "Fix dataset errors before training" : active ? "A training run is already active" : undefined}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Start Training
        </button>
        {stats.value.completed > 0 && (
          <button
            class="start-test-btn"
            onClick={handleTestClick}
            disabled={active}
            title={active ? "A training run is already active" : project.powerUserMode ? testCommandDisplay : "Run evaluation only"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Run Test
          </button>
        )}
        {active && (
          <button
            class="export-btn"
            onClick={() => {
              const runId = crypto.randomUUID();
              addToQueue(project.id, { command, cwd: project.projectPath, runId });
            }}
          >
            + Add to Queue
          </button>
        )}
      </div>
      {queueLength.value > 0 && (
        <span class="queue-indicator">Queue: {queueLength.value} remaining</span>
      )}
      {datasetInvalid && (
        <div class="dataset-invalid-msg">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Dataset structure has errors — fix them before training
        </div>
      )}
    </div>
  );
}

export function DashboardView() {
  const s = stats.value;
  const connected = sshConnected.value;
  const synced = dashboardSynced.value;
  const syncing = dashboardSyncing.value;
  const showingCompletion = syncShowingCompletion.value;
  const isPowerUser = currentProject.value?.powerUserMode;
  const [sharedMetrics, setSharedMetrics] = useState(null);
  const handleMetrics = useCallback((m) => setSharedMetrics(m), []);
  const [syncLogsOpen, setSyncLogsOpen] = useState(() => {
    try { return localStorage.getItem("nf-sync-logs-open") === "true"; } catch { return false; }
  });

  // Persist syncLogsOpen preference
  useEffect(() => {
    try { localStorage.setItem("nf-sync-logs-open", String(syncLogsOpen)); } catch { /* ignore */ }
  }, [syncLogsOpen]);

  // Close sync logs drawer on Escape
  useEffect(() => {
    if (!syncLogsOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setSyncLogsOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [syncLogsOpen]);

  // Auto-open drawer when sync starts in power mode
  useEffect(() => {
    if (syncing && isPowerUser) setSyncLogsOpen(true);
  }, [syncing, isPowerUser]);

  return (
    <div class="dashboard-view">
      <SshStatusBanner />
      {!connected ? null : syncing || showingCompletion || !synced ? (
        <SyncScreen />
      ) : (
        <>
          <div class="summary-grid">
            <SummaryCard
              label="Total Runs"
              value={s.totalRuns}
              icon={icons.total}
            />
            <SummaryCard
              label="Running"
              value={s.running}
              icon={icons.running}
              title={s.activeRunName ? `Active: ${s.activeRunName}` : undefined}
            />
            <SummaryCard
              label="Best Val Acc"
              value={
                s.bestAcc != null ? (s.bestAcc * 100).toFixed(1) + "%" : "—"
              }
              icon={icons.accuracy}
            />
            <SummaryCard
              label="Best Test Acc"
              value={
                s.bestTestAcc != null ? (s.bestTestAcc * 100).toFixed(1) + "%" : "—"
              }
              icon={icons.testAccuracy}
            />
          </div>
          <TrainingPanel />
          {projectQueue.value.length > 0 && (
            <div class="queue-section">
              <div class="queue-section-title">Queued Runs</div>
              <div class="queue-list">
                {projectQueue.value
                  .filter((q) => q.status === "queued")
                  .map((q, i) => (
                    <div key={q.id} class="queue-item">
                      <div class="queue-item-info">
                        <span class="queue-item-index">#{i + 1}</span>
                        <span>Queued run</span>
                        <span class="queue-item-time" style="color:var(--text-muted);font-size:0.75rem;margin-left:auto">
                          {new Date(q.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <button
                        class="queue-item-remove"
                        onClick={() => removeFromQueue(q.id)}
                        title="Remove from queue"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          )}
          {!trainingActive.value && <StartTrainingButton />}
          <div class="dashboard-split">
            <div class="dashboard-split-left">
              <DatasetStatusBanner />
              <EnvStatusBanner />
            </div>
            <div class="dashboard-split-right">
              <SystemMetricsPanel onMetrics={handleMetrics} />
            </div>
          </div>
          <GpuMetricsPanel metrics={sharedMetrics} />
          <ResyncButton />
        </>
      )}
      {/* Sync Logs — slide-over drawer */}
      {syncLogsOpen && isPowerUser && (
        <div class="sync-logs-drawer-overlay" onClick={() => setSyncLogsOpen(false)}>
          <div class="sync-logs-drawer" onClick={(e) => e.stopPropagation()}>
            <div class="sync-logs-drawer-header">
              <h3 class="sync-logs-drawer-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.55">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Sync Logs
              </h3>
              <button class="sync-logs-drawer-close" onClick={() => setSyncLogsOpen(false)} title="Close (Esc)">
                ✕
              </button>
            </div>
            <div class="sync-logs-drawer-body">
              <SyncLogsPanel />
            </div>
          </div>
        </div>
      )}
      <SshErrorModal />
    </div>
  );
}

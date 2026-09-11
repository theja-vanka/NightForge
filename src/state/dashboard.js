import { signal, computed } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../utils/notifications.js";
import {
  projectRuns,
  loadRuns,
  allRuns,
  loadRunScalars,
} from "./experiments.js";
import { currentProject, currentProjectId } from "./projects.js";
import { navigate, currentPage } from "./router.js";
import { saveSyncMetadata, getSyncMetadata } from "../db/database.js";
import { buildConfigYaml } from "../utils/configBuilder.js";
import { getTrainingRunId, cleanupTrainingState } from "./training.js";

// ── Per-project SSH state ─────────────────────────────────────────────────────
// Each project maintains its own independent connection state.

const _defaultState = () => ({
  connected: false,
  connecting: false,
  connectedAt: null,
  shouldAutoConnect: false,
  synced: false,
  syncing: false,
  syncProgress: 0,
  syncShowingCompletion: false,
  error: null,
  condaInfo: null,
  uvInfo: null,
  envInfo: null,
  syncLogs: [],
});

const _projectState = signal({}); // { [projectId]: ProjectState }

function _getState(projectId) {
  return _projectState.value[projectId] ?? _defaultState();
}

function _setState(projectId, updates) {
  const current = _getState(projectId);
  _projectState.value = {
    ..._projectState.value,
    [projectId]: { ...current, ...updates },
  };
}

// ── Computed signals (always reflect the active project) ──────────────────────

export const sshConnected = computed(
  () => _getState(currentProjectId.value).connected,
);
export const sshConnecting = computed(
  () => _getState(currentProjectId.value).connecting,
);
export const sshConnectedAt = computed(
  () => _getState(currentProjectId.value).connectedAt,
);
export const dashboardSynced = computed(
  () => _getState(currentProjectId.value).synced,
);
export const dashboardSyncing = computed(
  () => _getState(currentProjectId.value).syncing,
);
export const syncProgress = computed(
  () => _getState(currentProjectId.value).syncProgress,
);
export const syncShowingCompletion = computed(
  () => _getState(currentProjectId.value).syncShowingCompletion,
);
export const sshConnectionError = computed(
  () => _getState(currentProjectId.value).error,
);
export const condaInfo = computed(
  () => _getState(currentProjectId.value).condaInfo,
);
export const uvInfo = computed(() => _getState(currentProjectId.value).uvInfo);
export const envInfo = computed(
  () => _getState(currentProjectId.value).envInfo,
);
export const syncLogs = computed(
  () => _getState(currentProjectId.value).syncLogs,
);

// ── GPU availability (updated from system metrics polling) ──────────────────

export const gpuAvailable = signal(false);

// ── Platform detection (cached) ──────────────────────────────────────────────

export const platform = signal("unknown");
invoke("get_platform").then((p) => { platform.value = p; }).catch(() => { });

// ── Incremented to force useTerminal to tear down and reinitialize a session ──

export const terminalKey = signal(0);
export function bumpTerminalKey() {
  terminalKey.value++;
}

// ── Sync abort controller tracking ────────────────────────────────────────────

const _syncAbortControllers = {}; // { [projectId]: AbortController }

export function stopSync(projectId = currentProjectId.value) {
  const controller = _syncAbortControllers[projectId];
  if (controller) {
    controller.abort();
    delete _syncAbortControllers[projectId];
    _setState(projectId, { syncing: false });
  }
}

// ── Sync logging helper ───────────────────────────────────────────────────────

function addSyncLog(projectId, message, type = "info") {
  const current = _getState(projectId);
  const timestamp = new Date().toLocaleTimeString();
  const newLog = { message, type, timestamp };

  // Calculate progress based on sync milestones
  let progress = current.syncProgress;
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("starting sync")) {
    progress = 5;
  } else if (
    lowerMessage.includes("connecting to ssh") ||
    lowerMessage.includes("local mode")
  ) {
    progress = Math.max(progress, 8);
  } else if (lowerMessage.includes("creating project directory")) {
    progress = Math.max(progress, 12);
  } else if (lowerMessage.includes("directory ready")) {
    progress = Math.max(progress, 20);
  } else if (lowerMessage.includes("checking conda")) {
    progress = Math.max(progress, 28);
  } else if (
    lowerMessage.includes("conda ready") ||
    lowerMessage.includes("conda not found")
  ) {
    progress = Math.max(progress, 35);
  } else if (lowerMessage.includes("checking uv")) {
    progress = Math.max(progress, 38);
  } else if (lowerMessage.includes("uv ready")) {
    progress = Math.max(progress, 42);
  } else if (
    lowerMessage.includes("setting up python") ||
    lowerMessage.includes("python 3.12")
  ) {
    progress = Math.max(progress, 45);
  } else if (lowerMessage.includes("python environment ready")) {
    progress = Math.max(progress, 55);
  } else if (lowerMessage.includes("checking dataset paths")) {
    progress = Math.max(progress, 60);
  } else if (lowerMessage.includes("loading runs")) {
    progress = Math.max(progress, 75);
  } else if (lowerMessage.includes("scanning run logs")) {
    progress = Math.max(progress, 82);
  } else if (
    lowerMessage.includes("synced metrics") ||
    lowerMessage.includes("no run logs found")
  ) {
    progress = Math.max(progress, 92);
  } else if (lowerMessage.includes("sync completed successfully")) {
    progress = 100;
  }

  _setState(projectId, {
    syncLogs: [...current.syncLogs, newLog],
    syncProgress: progress,
  });
  console.log(`[${type.toUpperCase()}] ${timestamp} ${message}`);
}

// ── Stats (unchanged) ─────────────────────────────────────────────────────────

export const stats = computed(() => {
  const r = projectRuns.value;
  const completed = r.filter((x) => x.status === "completed");
  const running = r.filter((x) => x.status === "running");
  const failed = r.filter((x) => x.status === "failed");
  const queued = r.filter((x) => x.status === "queued");
  const bestAcc = completed.length
    ? Math.max(...completed.map((x) => x.bestAcc ?? 0))
    : null;

  // Best test accuracy across all runs that have test results
  const runsWithTestAcc = r.filter((x) => x.testAcc != null);
  const bestTestAcc = runsWithTestAcc.length
    ? Math.max(...runsWithTestAcc.map((x) => x.testAcc))
    : null;

  return {
    totalRuns: r.length,
    completed: completed.length,
    running: running.length,
    failed: failed.length,
    queued: queued.length,
    bestAcc,
    bestTestAcc,
    activeRunName: running.length > 0 ? (running[0].name || running[0].id) : null,
  };
});

// ── SSH state setters ─────────────────────────────────────────────────────────

export function setSshConnected(connected, projectId = currentProjectId.value) {
  const current = _getState(projectId);
  // Only reset synced when transitioning to a NEW connection (was not connected before).
  // If we're re-setting connected=true on an already-connected project (e.g. from
  // useTerminal._initSession), preserve the synced state to avoid sidebar collapse.
  const shouldResetSynced = connected ? !current.connected : true;
  _setState(projectId, {
    connected,
    connectedAt: connected ? new Date().toISOString() : null,
    ...(shouldResetSynced ? { synced: false } : {}),
  });
  // Navigate away from terminal if the active project disconnects
  if (
    !connected &&
    projectId === currentProjectId.value &&
    currentPage.value === "terminal"
  ) {
    navigate("dashboard");
  }
}

export function setSshConnecting(val, projectId = currentProjectId.value) {
  _setState(projectId, { connecting: val });
}

// ── SSH info computed ─────────────────────────────────────────────────────────

export const sshInfo = computed(() => {
  const project = currentProject.value;
  if (!project || !project.sshCommand) return null;
  const cmd = project.sshCommand.trim();
  if (cmd.toLowerCase() === "localhost") {
    return {
      command: "localhost",
      host: "localhost",
      connected: sshConnected.value,
      connectedAt: sshConnectedAt.value,
    };
  }
  const parts = cmd.split(/\s+/);
  const target = parts.find((p) => p.includes("@")) || parts[parts.length - 1];
  return {
    command: project.sshCommand,
    host: target,
    connected: sshConnected.value,
    connectedAt: sshConnectedAt.value,
  };
});

// ── Dataset path status ───────────────────────────────────────────────────────

export const datasetPathStatus = signal({
  folderPath: null,
  trainPath: null,
  valPath: null,
  testPath: null,
});

// Dataset structure validation result: { valid, errors, warnings, info } or null
export const datasetValidation = signal(null);

// ── Error helpers ─────────────────────────────────────────────────────────────

export function clearSshConnectionError(projectId = currentProjectId.value) {
  _setState(projectId, { error: null });
}

/** Remove per-project state when a project is deleted to prevent memory leaks. */
export function cleanupProjectState(projectId) {
  const { [projectId]: _, ...rest } = _projectState.value;
  _projectState.value = rest;
  delete _syncAbortControllers[projectId];
  cleanupTrainingState(projectId);
}

// ── Connect / disconnect ──────────────────────────────────────────────────────

export async function toggleSshConnection() {
  const projectId = currentProjectId.value;
  if (!projectId) return;

  if (sshConnected.value) {
    // Stop any ongoing sync first
    stopSync(projectId);

    // Disconnect: kill this project's terminal session
    setSshConnecting(true, projectId);
    try {
      await invoke("kill_terminal", { sessionId: projectId });
    } catch (err) {
      console.error("Error killing terminal:", err);
    }
    setSshConnected(false, projectId);
    _setState(projectId, { shouldAutoConnect: false, connecting: false });
  } else {
    // Connect
    _setState(projectId, { error: null });

    const project = currentProject.value;
    if (!project) return;

    const rawSsh = project.sshCommand;
    const isSSH =
      rawSsh && rawSsh.trim() && rawSsh.trim().toLowerCase() !== "localhost";

    // Kill any existing session for this project first
    try {
      await invoke("kill_terminal", { sessionId: projectId });
    } catch (_) {
      /* ignore errors */
    }

    if (isSSH) {
      setSshConnecting(true, projectId);
      _setState(projectId, { shouldAutoConnect: true });

      // 1. Verify SSH connectivity (fast, no output parsing)
      try {
        await invoke("test_ssh", { sshCommand: rawSsh.trim() });
      } catch (err) {
        setSshConnected(false, projectId);
        setSshConnecting(false, projectId);
        _setState(projectId, { error: { message: `${err}` } });
        return;
      }

      // 2. Spawn the interactive PTY session for this project
      try {
        await invoke("spawn_terminal", {
          sessionId: projectId,
          sshCommand: rawSsh.trim(),
        });
      } catch (err) {
        setSshConnected(false, projectId);
        setSshConnecting(false, projectId);
        _setState(projectId, {
          error: { message: `Failed to start SSH: ${err}` },
        });
        return;
      }

      // 3. Mark connected — test_ssh already verified reachability
      setSshConnected(true, projectId);
      setSshConnecting(false, projectId);
      notify("Connected", `SSH connection established to ${rawSsh.trim()}`);
    } else {
      // Local: mark connected immediately
      setSshConnected(true, projectId);
      notify("Connected", "Local environment ready");
    }

    // Bump key so useTerminal reinitializes for this project
    bumpTerminalKey();
  }
}

// ── Dashboard sync ────────────────────────────────────────────────────────────

export async function syncDashboard() {
  const projectId = currentProjectId.value;
  _setState(projectId, {
    syncing: true,
    syncLogs: [],
    syncProgress: 0,
    syncShowingCompletion: false,
  });
  addSyncLog(projectId, "Starting sync...", "info");

  // Create abort controller for this sync
  const abortController = new AbortController();
  _syncAbortControllers[projectId] = abortController;

  // Set a global timeout of 25 minutes to prevent indefinite hanging
  const syncTimeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error("Sync operation timed out after 25 minutes")),
      25 * 60 * 1000,
    ),
  );

  try {
    await Promise.race([doSync(projectId, abortController), syncTimeout]);
    addSyncLog(projectId, "Sync completed successfully ✓", "success");
    notify("Sync Complete", "Project synced successfully. Ready to train.");

    // Show 100% completion for 500ms
    _setState(projectId, {
      syncShowingCompletion: true,
      syncProgress: 100,
      syncing: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Mark as synced and hide completion screen
    _setState(projectId, {
      synced: true,
      syncShowingCompletion: false,
      syncProgress: 0,
    });

    // Persist sync metadata to IndexedDB
    const state = _getState(projectId);
    try {
      await saveSyncMetadata(projectId, {
        synced: true,
        lastSyncedAt: new Date().toISOString(),
        condaInfo: state.condaInfo,
        uvInfo: state.uvInfo,
        envInfo: state.envInfo,
        datasetPathStatus: datasetPathStatus.value,
        datasetValidation: datasetValidation.value,
        syncLogs: state.syncLogs,
      });
    } catch (e) {
      console.warn("[syncDashboard] Failed to persist sync metadata:", e);
    }
  } catch (err) {
    if (err.message === "AbortError") {
      addSyncLog(projectId, "Sync cancelled", "info");
    } else {
      console.error("[syncDashboard] timeout or error:", err);
      addSyncLog(projectId, `Sync failed: ${err.message}`, "error");
      notify("Sync Failed", err.message);
    }
    _setState(projectId, {
      syncing: false,
      syncProgress: 0,
      syncShowingCompletion: false,
    });
  } finally {
    delete _syncAbortControllers[projectId];
  }
}

async function doSync(projectId, abortController) {
  try {
    // Check if aborted before starting
    if (abortController.signal.aborted) throw new Error("AbortError");

    const project = currentProject.value;
    if (project?.projectPath) {
      const rawSsh = project.sshCommand;
      const isSSH =
        rawSsh && rawSsh.trim() && rawSsh.trim().toLowerCase() !== "localhost";

      // Check abort signal before directory creation
      if (abortController.signal.aborted) throw new Error("AbortError");

      try {
        if (isSSH) {
          addSyncLog(projectId, `Connecting to SSH: ${rawSsh.trim()}`, "info");
          addSyncLog(
            projectId,
            "Creating project directory on remote...",
            "info",
          );
          await Promise.race([
            invoke("ssh_mkdir", {
              sshCommand: rawSsh.trim(),
              path: project.projectPath,
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("ssh_mkdir timed out")), 30000),
            ),
          ]);
          addSyncLog(projectId, "Remote directory ready", "success");
        } else {
          addSyncLog(projectId, "Local mode", "info");
          addSyncLog(
            projectId,
            "Creating project directory locally...",
            "info",
          );
          await Promise.race([
            invoke("ensure_project_dir", { path: project.projectPath }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("ensure_project_dir timed out")),
                10000,
              ),
            ),
          ]);
          addSyncLog(projectId, "Local directory ready", "success");
        }
      } catch (dirErr) {
        console.warn(
          "[syncDashboard] Could not ensure project directory:",
          dirErr,
        );
        addSyncLog(projectId, `Warning: ${dirErr.message}`, "warning");
      }

      // Check conda first, fall back to uv if conda not available
      if (abortController.signal.aborted) throw new Error("AbortError");
      let useConda = false;
      try {
        addSyncLog(projectId, "Checking conda installation...", "info");
        const condaResult = isSSH
          ? await invoke("ssh_check_conda", { sshCommand: rawSsh.trim() })
          : await invoke("check_conda");
        _setState(projectId, {
          condaInfo: {
            installed: condaResult.installed,
            version: condaResult.version || null,
            message: condaResult.message,
          },
        });
        if (condaResult.installed) {
          useConda = true;
          addSyncLog(
            projectId,
            `conda ready (${condaResult.version || "installed"})`,
            "success",
          );
        } else {
          addSyncLog(projectId, "conda not found, falling back to uv", "info");
        }
      } catch (condaErr) {
        console.warn("[syncDashboard] conda check failed:", condaErr);
        addSyncLog(
          projectId,
          "conda not available, falling back to uv",
          "info",
        );
        _setState(projectId, {
          condaInfo: {
            installed: false,
            version: null,
            message: `${condaErr}`,
          },
        });
      }

      // If conda not available, ensure uv is installed
      if (!useConda) {
        if (abortController.signal.aborted) throw new Error("AbortError");
        try {
          addSyncLog(projectId, "Checking uv installation...", "info");
          const uvResult = isSSH
            ? await invoke("ssh_ensure_uv", { sshCommand: rawSsh.trim() })
            : await invoke("ensure_uv");
          _setState(projectId, {
            uvInfo: {
              installed: uvResult.installed,
              version: uvResult.version || null,
              message: uvResult.message,
            },
          });
          if (uvResult.installed) {
            addSyncLog(
              projectId,
              `uv ready (${uvResult.version || "installed"})`,
              "success",
            );
          } else {
            addSyncLog(
              projectId,
              `uv not available: ${uvResult.message}`,
              "warning",
            );
          }
        } catch (uvErr) {
          console.warn("[syncDashboard] uv check failed:", uvErr);
          addSyncLog(projectId, `uv check error: ${uvErr}`, "warning");
          _setState(projectId, {
            uvInfo: { installed: false, version: null, message: `${uvErr}` },
          });
        }
      }

      // Set up Python venv with autotimm if it doesn't exist yet (can take a while)
      if (abortController.signal.aborted) throw new Error("AbortError");
      try {
        addSyncLog(projectId, "Setting up Python 3.12 environment with latest autotimm...", "info");
        const envPromise = isSSH
          ? invoke("ssh_setup_python_env", {
            sshCommand: rawSsh.trim(),
            projectPath: project.projectPath,
          })
          : invoke("setup_python_env", { projectPath: project.projectPath });

        const timeout = isSSH ? 1200000 : 600000; // 20 min for SSH, 10 min for local
        const envResult = await Promise.race([
          envPromise,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Python env setup timed out")),
              timeout,
            ),
          ),
        ]);

        if (envResult.status === "error") {
          addSyncLog(
            projectId,
            `Python env error: ${envResult.message}`,
            "warning",
          );
          _setState(projectId, {
            envInfo: { status: "error", message: envResult.message },
          });
        } else {
          const versionInfo = `Python ${envResult.python_version || "?"}, autotimm ${envResult.autotimm_version || "?"}`;
          addSyncLog(
            projectId,
            `Python environment ready (${versionInfo})`,
            "success",
          );
          _setState(projectId, {
            envInfo: {
              status: envResult.status,
              pythonVersion: envResult.python_version || null,
              autotimmVersion: envResult.autotimm_version || null,
              envType: envResult.env_type || null,
            },
          });
        }
      } catch (envErr) {
        console.warn("[syncDashboard] Python env setup failed:", envErr);
        addSyncLog(projectId, `Python env setup failed: ${envErr}`, "error");
        _setState(projectId, {
          envInfo: { status: "error", message: `${envErr}` },
        });
      }

      addSyncLog(projectId, "Checking dataset paths...", "info");
      const status = {
        folderPath: null,
        trainPath: null,
        valPath: null,
        testPath: null,
      };
      const pathsToCheck = [];
      if (project.folderPath)
        pathsToCheck.push({ key: "folderPath", path: project.folderPath });
      if (project.trainPath)
        pathsToCheck.push({ key: "trainPath", path: project.trainPath });
      if (project.valPath)
        pathsToCheck.push({ key: "valPath", path: project.valPath });
      if (project.testPath)
        pathsToCheck.push({ key: "testPath", path: project.testPath });

      if (pathsToCheck.length > 0) {
        await Promise.all(
          pathsToCheck.map(async ({ key, path }) => {
            try {
              status[key] = isSSH
                ? await invoke("ssh_check_path", {
                  sshCommand: rawSsh.trim(),
                  path,
                })
                : await invoke("check_path_exists", { path });
              if (status[key]) {
                addSyncLog(projectId, `✓ ${key}: ${path}`, "success");
              } else {
                addSyncLog(projectId, `✗ ${key} not found: ${path}`, "warning");
              }
            } catch {
              status[key] = null;
              addSyncLog(
                projectId,
                `✗ Could not check ${key}: ${path}`,
                "warning",
              );
            }
          }),
        );
      }
      datasetPathStatus.value = status;

      // Validate folder structure (only for folder-based formats on localhost)
      const folderFormats = ["Folder", "COCO JSON", "COCO", "PNG Masks", "Cityscapes", "VOC"];
      if (
        !isSSH &&
        project.folderPath &&
        status.folderPath === true &&
        folderFormats.includes(project.datasetFormat)
      ) {
        try {
          addSyncLog(projectId, "Validating dataset structure...", "info");
          const validation = await invoke("validate_dataset_structure", {
            path: project.folderPath,
            taskType: project.taskType,
            format: project.datasetFormat,
          });
          datasetValidation.value = validation;
          if (validation.valid) {
            const parts = [];
            if (validation.info?.classes) parts.push(`${validation.info.classes} classes`);
            if (validation.info?.images) parts.push(`${validation.info.images} images`);
            if (validation.info?.categories) parts.push(`${validation.info.categories} categories`);
            const summary = parts.length > 0 ? ` (${parts.join(", ")})` : "";
            addSyncLog(projectId, `✓ Dataset structure valid${summary}`, "success");
          } else {
            for (const err of validation.errors) {
              addSyncLog(projectId, `✗ ${err}`, "error");
            }
          }
          for (const w of validation.warnings || []) {
            addSyncLog(projectId, `⚠ ${w}`, "warning");
          }
        } catch (valErr) {
          console.warn("[doSync] Dataset validation failed:", valErr);
          datasetValidation.value = null;
        }
      } else {
        datasetValidation.value = null;
      }
    }

    if (abortController.signal.aborted) throw new Error("AbortError");
    addSyncLog(projectId, "Loading runs...", "info");
    await loadRuns();

    // Discover .jsonl files on disk, create missing runs, and sync scalars
    if (project.projectPath) {
      try {
        addSyncLog(projectId, "Scanning run logs...", "info");
        const runIds = await invoke("list_run_folders", {
          projectPath: project.projectPath,
        });

        if (runIds && runIds.length > 0) {
          const existingById = new Map();
          for (const r of allRuns.value) {
            if (r.projectId === projectId) {
              existingById.set(r.id, r);
            }
          }

          // Sync scalars from TensorBoard/JSONL for runs that exist in the DB
          let synced = 0;
          for (const folder of runIds) {
            if (abortController.signal.aborted) throw new Error("AbortError");
            // Only process folders whose run_id matches an existing DB run
            const run = existingById.get(folder);
            if (!run) continue;
            try {
              const result = await loadRunScalars(run);
              if (result) synced++;
            } catch {
              // logs may be empty or malformed — skip
            }
          }
          addSyncLog(
            projectId,
            `Synced metrics for ${synced} of ${runIds.length} run(s)`,
            "success",
          );
        } else {
          addSyncLog(projectId, "No run logs found", "info");
        }
      } catch (err) {
        console.warn("[doSync] JSONL scan failed:", err);
        addSyncLog(projectId, `Run log scan warning: ${err}`, "warning");
      }
    }

    _setState(projectId, { synced: true });
  } catch (err) {
    if (err.message === "AbortError") {
      console.log("[doSync] Sync aborted by user");
    } else {
      console.error("[doSync] error:", err);
      addSyncLog(projectId, `Sync error: ${err.message}`, "error");
    }
    throw err;
  }
}

// ── Config YAML generation ─────────────────────────────────────────────────

export async function syncConfig(
  project = currentProject.value,
  projectId = currentProjectId.value,
  runId = null,
) {
  if (!project || !project.projectPath) return;

  // Use passed runId, or active training runId, or fallback to 'default'
  const finalRunId = runId || getTrainingRunId(projectId) || "default";
  const yaml = buildConfigYaml(project, finalRunId);
  const pp = (project.projectPath.endsWith("/") || project.projectPath.endsWith("\\"))
    ? project.projectPath.slice(0, -1)
    : project.projectPath;
  const sep = project.projectPath.includes("\\") ? "\\" : "/";
  const configPath = `${pp}${sep}config.yaml`;

  const rawSsh = project.sshCommand;
  const isSSH =
    rawSsh && rawSsh.trim() && rawSsh.trim().toLowerCase() !== "localhost";

  try {
    if (isSSH) {
      await invoke("ssh_write_file", {
        sshCommand: rawSsh.trim(),
        path: configPath,
        contents: yaml,
      });
    } else {
      await invoke("write_file", { path: configPath, contents: yaml });
    }
    addSyncLog(projectId, "Config YAML written", "success");
  } catch (err) {
    addSyncLog(projectId, `Failed to write config.yaml: ${err}`, "warning");
    console.warn("[syncConfig] write error:", err);
    throw err;
  }
}

// ── Restore persisted sync state ────────────────────────────────────────────

export async function restoreSyncState(projectId) {
  try {
    const metadata = await getSyncMetadata(projectId);
    if (!metadata) return;
    _setState(projectId, {
      synced: metadata.synced ?? false,
      condaInfo: metadata.condaInfo ?? null,
      uvInfo: metadata.uvInfo ?? null,
      envInfo: metadata.envInfo ?? null,
      syncLogs: metadata.syncLogs ?? [],
    });
    if (metadata.datasetPathStatus) {
      datasetPathStatus.value = metadata.datasetPathStatus;
    }
    datasetValidation.value = metadata.datasetValidation ?? null;
  } catch (e) {
    console.warn("[restoreSyncState] Failed to restore sync metadata:", e);
  }
}

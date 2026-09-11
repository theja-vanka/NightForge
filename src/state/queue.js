import { signal, computed } from "@preact/signals";
import { currentProjectId, projectList } from "./projects.js";
import { startTraining } from "./training.js";
import { syncConfig } from "./dashboard.js";

// ── Run Queue ───────────────────────────────────────────────────────────────

export const runQueue = signal([]);
// Each entry: { id, projectId, config: { command, cwd, runId }, status: 'queued'|'running'|'done'|'failed' }

export const queueLength = computed(
  () => runQueue.value.filter((q) => q.status === "queued").length,
);

export const projectQueue = computed(
  () =>
    runQueue.value.filter(
      (q) =>
        q.projectId === currentProjectId.value &&
        (q.status === "queued" || q.status === "running"),
    ),
);

export function addToQueue(projectId, config) {
  const entry = {
    id: crypto.randomUUID(),
    projectId,
    config,
    status: "queued",
    createdAt: Date.now(),
  };
  runQueue.value = [...runQueue.value, entry];
  return entry.id;
}

export function removeFromQueue(id) {
  runQueue.value = runQueue.value.filter((q) => q.id !== id);
}

export function clearQueue() {
  runQueue.value = runQueue.value.filter((q) => q.status === "running");
}

/**
 * Called when training completes or fails for a project.
 * Starts the next queued run if one exists.
 */
export async function processQueue(projectId, status = "done") {
  // Mark current running entry as done
  runQueue.value = runQueue.value.map((q) =>
    q.projectId === projectId && q.status === "running"
      ? { ...q, status }
      : q,
  );

  // Find the next queued entry for this project
  const next = runQueue.value.find(
    (q) => q.projectId === projectId && q.status === "queued",
  );
  if (!next) return;

  // Mark it as running
  runQueue.value = runQueue.value.map((q) =>
    q.id === next.id ? { ...q, status: "running" } : q,
  );

  const project = projectList.value.find((p) => p.id === projectId);
  if (project && next.config) {
    try {
      await syncConfig(project, projectId, next.config.runId);
      await startTraining(next.config.command, next.config.cwd, next.config.runId, { projectId });
    } catch (error) {
      runQueue.value = runQueue.value.map((q) => q.id === next.id ? { ...q, status: "failed", error: String(error) } : q);
    }
  }
}

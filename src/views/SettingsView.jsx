import { CsvColumnFields } from "../components/CsvColumnFields.jsx";
import { useState, useEffect, useRef } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { validateTrainingProject } from "../utils/configBuilder.js";
import { theme, toggleTheme } from "../state/theme.js";
import {
  currentProject,
  updateProject,
  openDeleteDialog,
  addProject,
  TASK_TYPES,
  MODEL_CATEGORIES,
  YOLOX_MODEL_CATEGORIES,
  DETECTION_MODEL_CATEGORIES,
  SEGMENTATION_MODEL_CATEGORIES,
  DATASET_FORMATS,
  DETECTION_ARCHS,
  SEG_HEAD_TYPES,
} from "../state/projects.js";
import { sshConnected, syncConfig, platform } from "../state/dashboard.js";
import { allRuns, loadRuns } from "../state/experiments.js";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog.jsx";
import { clearAllData, saveRun } from "../db/database.js";
import { downloadFile } from "../utils/exportRuns.js";
import { projectList } from "../state/projects.js";
import { navigate } from "../state/router.js";
import { startTutorial } from "../state/tutorial.js";

const EDITABLE_KEYS = [
  "name",
  "connectionType",
  "sshCommand",
  "projectPath",
  "modelCategory",
  "detectionArch",
  "segHeadType",
  "datasetFormat",
  "folderPath",
  "trainPath",
  "valPath",
  "testPath",
  "numClasses",
  "powerUserMode",
  "maxEpochs",
  "learningRate",
  "batchSize",
  "optimizer",
  "scheduler",
  "weightDecay",
  "precision",
  "gradientClipVal",
  "imageSize",
  "augmentationPreset",
  "freezeBackbone",
  "seed",
  "earlyStopping",
  "earlyStoppingPatience",
  "earlyStoppingMonitor",
  "gpuDevices",
  "imageFolderPath",
  "imageColumn",
  "labelColumn",
  "labelColumns",
  "accelerator",
  "numWorkers",
  "compileModel",
];

// Read-only fields that need to be included in draft for rendering
const READONLY_KEYS = ["taskType"];

/** Tasks whose CSV datasets carry a mask column alongside the image column. */
const SEGMENTATION_TASKS = ["Semantic Segmentation", "Instance Segmentation"];

function pick(obj) {
  const out = {};
  // Include editable fields
  for (const k of EDITABLE_KEYS) {
    // Provide default values for fields that might not exist in older projects
    out[k] = obj[k] !== undefined ? obj[k] : "";
  }
  // Include read-only fields (needed for rendering but not editable)
  for (const k of READONLY_KEYS) {
    out[k] = obj[k];
  }
  return out;
}

function isDirty(draft, source) {
  for (const k of EDITABLE_KEYS) {
    if (draft[k] !== (source[k] ?? "")) return true;
  }
  return false;
}

const pathBase = () => platform.value === "windows" ? "~\\nightflow\\projects\\" : "~/nightflow/projects/";
const sanitizeForPath = (n) =>
  n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const sunIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
const moonIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const trashIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const checkIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const lockIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

function ClearAllDataRow() {
  const [showDialog, setShowDialog] = useState(false);

  return (
    <div
      class="settings-card-row settings-row-between"
      style="margin-top: 12px;"
    >
      <div>
        <div class="settings-label">Clear all data</div>
        <div class="settings-desc">
          Wipe all projects, runs, and metrics from the app. This cannot be
          undone.
        </div>
      </div>
      <button class="settings-danger-btn" onClick={() => setShowDialog(true)}>
        <span dangerouslySetInnerHTML={{ __html: trashIcon }} />
        Clear All Data
      </button>
      {showDialog && (
        <ClearAllDataDialog onClose={() => setShowDialog(false)} />
      )}
    </div>
  );
}

function ClearAllDataDialog({ onClose }) {
  const [confirmText, setConfirmText] = useState("");
  const [clearing, setClearing] = useState(false);
  const confirmed = confirmText.toLowerCase() === "permanently delete";

  async function handleClear() {
    if (!confirmed) return;
    setClearing(true);
    try {
      await clearAllData();
      projectList.value = [];
      allRuns.value = [];
      navigate("dashboard");
      window.location.reload();
    } catch (err) {
      console.error("Failed to clear data:", err);
      setClearing(false);
    }
  }

  return (
    <div
      class="wizard-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="delete-dialog">
        <div class="delete-dialog-header">
          <h2>Clear All Data</h2>
          <button class="wizard-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>
        <div class="delete-dialog-body">
          <p class="delete-dialog-warning">
            This will permanently delete <strong>all projects</strong>, runs,
            and metrics from the app. This action cannot be undone.
          </p>
          <p class="delete-dialog-prompt">
            Type <strong>permanently delete</strong> to confirm:
          </p>
          <input
            class="wizard-input delete-dialog-input"
            type="text"
            placeholder="Type permanently delete to confirm"
            value={confirmText}
            onInput={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && confirmed) handleClear();
            }}
            autoFocus
          />
        </div>
        <div class="wizard-footer">
          <button class="wizard-btn wizard-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            class="wizard-btn wizard-btn-danger"
            disabled={!confirmed || clearing}
            onClick={handleClear}
          >
            {clearing ? "Clearing..." : "Delete Everything"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SshKeysSection() {
  const [keys, setKeys] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    invoke("list_ssh_keys")
      .then((k) => {
        setKeys(k);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  return (
    <section class="settings-section">
      <div class="settings-section-header">
        <h2 class="settings-heading">SSH Keys</h2>
        <p class="settings-heading-desc">
          Detected SSH keys from ~/.ssh/
        </p>
      </div>
      <div class="settings-card">
        {keys.length === 0 ? (
          <div class="settings-card-row">
            <div class="settings-desc">No SSH keys found in ~/.ssh/</div>
          </div>
        ) : (
          <div class="ssh-keys-list">
            {keys.map((k) => (
              <div key={k.name} class="ssh-key-item">
                <div class="ssh-key-info">
                  <span class="ssh-key-name">{k.name}</span>
                  <span class="ssh-key-fingerprint">{k.fingerprint}</span>
                </div>
                <span class="ssh-key-type">{k.key_type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function SettingsView() {
  const proj = currentProject.value;
  const [draft, setDraft] = useState(() => {
    if (!proj) return {};
    const pickedData = pick(proj);
    // Ensure critical fields have values for proper rendering
    if (!pickedData.connectionType) pickedData.connectionType = "localhost";
    if (!pickedData.sshCommand) pickedData.sshCommand = "localhost";
    if (!pickedData.taskType) pickedData.taskType = "Classification";
    if (!pickedData.modelCategory) pickedData.modelCategory = "Edge";
    if (!pickedData.datasetFormat) pickedData.datasetFormat = "Folder";
    if (!pickedData.detectionArch) pickedData.detectionArch = "fcos";
    if (!pickedData.segHeadType) pickedData.segHeadType = "deeplabv3plus";
    return pickedData;
  });
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);
  const [augPreviewOpen, setAugPreviewOpen] = useState(false);
  const [augPreviewImages, setAugPreviewImages] = useState([]);
  const [augPreviewLoading, setAugPreviewLoading] = useState(false);
  const [augPreviewError, setAugPreviewError] = useState(null);
  const [augSourceImage, setAugSourceImage] = useState(null);

  // Re-sync draft when switching projects
  useEffect(() => {
    if (proj) {
      const pickedData = pick(proj);
      // Ensure critical fields have values for proper rendering
      if (!pickedData.connectionType) pickedData.connectionType = "localhost";
      if (!pickedData.sshCommand) pickedData.sshCommand = "localhost";
      if (!pickedData.taskType) pickedData.taskType = "Classification";
      if (!pickedData.modelCategory) pickedData.modelCategory = "Edge";
      if (!pickedData.datasetFormat) pickedData.datasetFormat = "Folder";
      if (!pickedData.detectionArch) pickedData.detectionArch = "fcos";
      if (!pickedData.segHeadType) pickedData.segHeadType = "deeplabv3plus";
      setDraft(pickedData);
    }
  }, [proj?.id]);

  if (!proj)
    return (
      <div class="settings-view">
        <p class="settings-empty">No project selected.</p>
      </div>
    );

  const [activeTab, setActiveTab] = useState("general");
  const locked = sshConnected.value;
  const dirty = isDirty(draft, proj);

  // Reset to general tab if power user mode is turned off
  useEffect(() => {
    if (!draft.powerUserMode && activeTab === "advanced") {
      setActiveTab("general");
    }
  }, [draft.powerUserMode]);

  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  function onTaskTypeChange(newTask) {
    const formats = DATASET_FORMATS[newTask] || [];
    const formatStillValid = formats.some((f) => f.id === draft.datasetFormat);
    setDraft((d) => ({
      ...d,
      taskType: newTask,
      datasetFormat: formatStillValid ? d.datasetFormat : "",
    }));
    setSaved(false);
  }

  function ensureTrailingSlash(p) {
    if (!p || p.endsWith("/") || p.endsWith("\\")) return p;
    return p + (platform.value === "windows" ? "\\" : "/");
  }

  async function handleSave() {
    try {
      const normalized = { ...draft };
      validateTrainingProject(normalized);
      if (normalized.projectPath)
        normalized.projectPath = ensureTrailingSlash(normalized.projectPath);
      if (normalized.folderPath)
        normalized.folderPath = ensureTrailingSlash(normalized.folderPath);
      await updateProject(proj.id, normalized);
      // Regenerate config.yaml with updated settings
      const updatedProject = { ...proj, ...normalized };
      await syncConfig(updatedProject, proj.id);
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error saving project:", error);
      alert(`Could not save training configuration: ${error.message || error}`);
    }
  }

  function handleDiscard() {
    setDraft(pick(proj));
    setSaved(false);
  }

  const isDetection = draft.taskType === "Object Detection";
  const isSegmentation =
    draft.taskType === "Semantic Segmentation" ||
    draft.taskType === "Instance Segmentation";
  const datasetFormats = DATASET_FORMATS[draft.taskType] || [];
  const modelCatSource =
    isDetection && draft.detectionArch === "yolox"
      ? YOLOX_MODEL_CATEGORIES
      : isDetection
        ? DETECTION_MODEL_CATEGORIES
        : isSegmentation
          ? SEGMENTATION_MODEL_CATEGORIES
          : MODEL_CATEGORIES;
  const modelCatDesc = draft.modelCategory
    ? modelCatSource[draft.modelCategory]?.desc
    : null;

  const derivedProjectPath = draft.name
    ? `${pathBase()}${sanitizeForPath(draft.name)}`
    : pathBase();

  return (
    <div class="settings-view">
      {locked && (
        <div class="settings-locked-banner">
          <span dangerouslySetInnerHTML={{ __html: lockIcon }} />
          Settings are locked while connected. Disconnect to make changes.
        </div>
      )}

      {/* Tab navigation — only show tabs when power user mode is on */}
      {draft.powerUserMode && (
        <div class="settings-tabs">
          <button
            class={`settings-tab ${activeTab === "general" ? "settings-tab--active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
          <button
            class={`settings-tab ${activeTab === "advanced" ? "settings-tab--active" : ""}`}
            onClick={() => setActiveTab("advanced")}
          >
            Advanced Training
          </button>
        </div>
      )}

      {/* ─── General Tab ─── */}
      {activeTab === "general" && (
        <>
          {/* General */}
          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">General</h2>
              <p class="settings-heading-desc">
                Basic project identity and connection
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Project ID</span>
                  <span class="settings-hint">
                    Unique identifier (read-only)
                  </span>
                  <input
                    class="settings-input settings-input-mono"
                    type="text"
                    value={proj.id}
                    disabled
                    readOnly
                  />
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Project Name</span>
                  <input
                    class="settings-input"
                    type="text"
                    value={draft.name}
                    placeholder="My Project"
                    disabled={locked}
                    onInput={(e) => set("name", e.target.value)}
                  />
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Project Path</span>
                  <input
                    class="settings-input settings-input-mono"
                    type="text"
                    value={draft.projectPath || ""}
                    placeholder={derivedProjectPath}
                    disabled={locked}
                    onInput={(e) => set("projectPath", e.target.value)}
                  />
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row settings-row-grid">
                <label class="settings-field">
                  <span class="settings-label">Connection Type</span>
                  <span class="settings-hint">Where to run training</span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.connectionType || "localhost"}
                      disabled={locked}
                      onChange={(e) => {
                        const newType = e.target.value;
                        set("connectionType", newType);
                        if (newType === "localhost") {
                          set("sshCommand", "localhost");
                        } else if (draft.sshCommand === "localhost") {
                          set("sshCommand", "");
                        }
                      }}
                    >
                      <option value="localhost">Localhost</option>
                      <option value="remote">Remote Instance</option>
                    </select>
                  </div>
                </label>
                <label class="settings-field">
                  <span class="settings-label">SSH Command</span>
                  <span class="settings-hint">
                    {draft.connectionType === "remote"
                      ? "Remote machine connection string"
                      : "Set to localhost"}
                  </span>
                  <input
                    class="settings-input settings-input-mono"
                    type="text"
                    value={draft.sshCommand}
                    placeholder={
                      draft.connectionType === "remote"
                        ? "ssh user@host"
                        : "localhost"
                    }
                    disabled={locked || draft.connectionType !== "remote"}
                    onInput={(e) => set("sshCommand", e.target.value)}
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Training */}
          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">Training</h2>
              <p class="settings-heading-desc">
                Task configuration and model selection
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row settings-row-grid">
                <label class="settings-field">
                  <span class="settings-label">Task Type</span>
                  <span class="settings-hint">
                    Set at project creation (read-only)
                  </span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.taskType}
                      disabled
                      onChange={(e) => onTaskTypeChange(e.target.value)}
                    >
                      {TASK_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                </label>
                <label class="settings-field">
                  <span class="settings-label">Model Category</span>
                  <span class="settings-hint">Deployment target tier</span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.modelCategory}
                      disabled={locked}
                      onChange={(e) => set("modelCategory", e.target.value)}
                    >
                      <option value="">Select category</option>
                      {Object.keys(modelCatSource).map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                </label>
              </div>
              {modelCatDesc && (
                <div class="settings-card-note">{modelCatDesc}</div>
              )}

              {isDetection && (
                <>
                  <div class="settings-card-divider" />
                  <div class="settings-card-row">
                    <label class="settings-field">
                      <span class="settings-label">Detection Architecture</span>
                      <div class="settings-select-wrap settings-select-narrow">
                        <select
                          class="settings-select"
                          value={draft.detectionArch}
                          disabled={locked}
                          onChange={(e) => set("detectionArch", e.target.value)}
                        >
                          {DETECTION_ARCHS.map((a) => (
                            <option key={a} value={a}>
                              {a}
                            </option>
                          ))}
                        </select>
                        <span class="settings-select-chevron" />
                      </div>
                    </label>
                  </div>
                </>
              )}
              {isSegmentation && (
                <>
                  <div class="settings-card-divider" />
                  <div class="settings-card-row">
                    <label class="settings-field">
                      <span class="settings-label">Segmentation Head</span>
                      <div class="settings-select-wrap settings-select-narrow">
                        <select
                          class="settings-select"
                          value={draft.segHeadType}
                          disabled={locked}
                          onChange={(e) => set("segHeadType", e.target.value)}
                        >
                          {SEG_HEAD_TYPES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <span class="settings-select-chevron" />
                      </div>
                    </label>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* Dataset */}
          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">Dataset</h2>
              <p class="settings-heading-desc">
                Data format and paths for training pipeline
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Format</span>
                  <span class="settings-hint">
                    {datasetFormats.length} format
                    {datasetFormats.length !== 1 ? "s" : ""} available for{" "}
                    {draft.taskType}
                  </span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.datasetFormat || ""}
                      disabled={locked}
                      onChange={(e) => set("datasetFormat", e.target.value)}
                    >
                      <option value="">Select format</option>
                      {datasetFormats.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                </label>
              </div>

              {draft.datasetFormat &&
                draft.datasetFormat !== "CSV" &&
                draft.datasetFormat !== "JSONL" && (
                  <>
                    <div class="settings-card-divider" />
                    <div class="settings-card-row">
                      <label class="settings-field">
                        <span class="settings-label">Dataset Folder Path</span>
                        <span class="settings-hint">
                          Path to {draft.datasetFormat} dataset folder
                        </span>
                        <input
                          class="settings-input settings-input-mono"
                          type="text"
                          value={draft.folderPath || ""}
                          placeholder={platform.value === "windows" ? "C:\\path\\to\\dataset" : "/path/to/dataset"}
                          disabled={locked}
                          onInput={(e) => set("folderPath", e.target.value)}
                        />
                      </label>
                    </div>
                  </>
                )}

              {(draft.datasetFormat === "CSV" ||
                draft.datasetFormat === "JSONL") && (
                  <>
                    <div class="settings-card-divider" />
                    <div class="settings-card-row">
                      <label class="settings-field">
                        <span class="settings-label">Train Path</span>
                        <span class="settings-hint">
                          Path to training data file
                        </span>
                        <input
                          class="settings-input settings-input-mono"
                          type="text"
                          value={draft.trainPath || ""}
                          placeholder={platform.value === "windows" ? `C:\\path\\to\\train.${draft.datasetFormat.toLowerCase()}` : `/path/to/train.${draft.datasetFormat.toLowerCase()}`}
                          disabled={locked}
                          onInput={(e) => set("trainPath", e.target.value)}
                        />
                      </label>
                    </div>
                    <div class="settings-card-divider" />
                    <div class="settings-card-row">
                      <label class="settings-field">
                        <span class="settings-label">Val Path</span>
                        <span class="settings-hint">
                          Path to validation data file (optional)
                        </span>
                        <input
                          class="settings-input settings-input-mono"
                          type="text"
                          value={draft.valPath || ""}
                          placeholder={platform.value === "windows" ? `C:\\path\\to\\val.${draft.datasetFormat.toLowerCase()}` : `/path/to/val.${draft.datasetFormat.toLowerCase()}`}
                          disabled={locked}
                          onInput={(e) => set("valPath", e.target.value)}
                        />
                      </label>
                    </div>
                    <div class="settings-card-divider" />
                    <div class="settings-card-row">
                      <label class="settings-field">
                        <span class="settings-label">Test Path</span>
                        <span class="settings-hint">Path to test data file</span>
                        <input
                          class="settings-input settings-input-mono"
                          type="text"
                          value={draft.testPath || ""}
                          placeholder={platform.value === "windows" ? `C:\\path\\to\\test.${draft.datasetFormat.toLowerCase()}` : `/path/to/test.${draft.datasetFormat.toLowerCase()}`}
                          disabled={locked}
                          onInput={(e) => set("testPath", e.target.value)}
                        />
                      </label>
                    </div>
                  </>
                )}

              {draft.datasetFormat === "CSV" && <div class="settings-card-row"><CsvColumnFields value={draft} onChange={set} disabled={locked} /></div>}

              {(draft.datasetFormat === "CSV" || draft.datasetFormat === "JSONL") && (
                <>
                  <div class="settings-card-divider" />
                  <div class="settings-card-row">
                    <label class="settings-field">
                      {/* Semantic segmentation resolves this as AutoTimm's data_dir and
                          instance segmentation as its image_dir; both resolve mask paths
                          alongside images, while the other tasks have no mask column. */}
                      <span class="settings-label">
                        {SEGMENTATION_TASKS.includes(draft.taskType)
                          ? "Image / mask root directory"
                          : "Image root directory"}
                      </span>
                      <span class="settings-hint">
                        {SEGMENTATION_TASKS.includes(draft.taskType)
                          ? "Directory used to resolve relative image and mask paths in the dataset."
                          : "Directory used to resolve relative image paths in the dataset."}
                      </span>
                      <input class="settings-input" value={draft.imageFolderPath} disabled={locked} onInput={(e) => set("imageFolderPath", e.target.value)} />
                    </label>
                  </div>
                </>
              )}

              <div class="settings-card-divider" />
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Number of Classes</span>
                  <span class="settings-hint">
                    Target classes in your dataset
                  </span>
                  <input
                    class="settings-input"
                    type="number"
                    min="2"
                    value={draft.numClasses}
                    placeholder="e.g. 10"
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "numClasses",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          </section>

          {/* SSH Keys */}
          <SshKeysSection />

          {/* Appearance */}
          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">Appearance</h2>
              <p class="settings-heading-desc">Visual preferences</p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Theme</div>
                  <div class="settings-desc">
                    Switch between dark and light mode
                  </div>
                </div>
                <button class="settings-theme-btn" onClick={toggleTheme}>
                  <span
                    class="settings-theme-icon"
                    dangerouslySetInnerHTML={{
                      __html: theme.value === "dark" ? sunIcon : moonIcon,
                    }}
                  />
                  {theme.value === "dark" ? "Dark" : "Light"}
                </button>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Power User Mode</div>
                  <div class="settings-desc">
                    Enable advanced features and controls
                  </div>
                </div>
                <button
                  class="settings-theme-btn"
                  disabled={locked}
                  onClick={() => set("powerUserMode", !draft.powerUserMode)}
                >
                  {draft.powerUserMode ? "On" : "Off"}
                </button>
              </div>
            </div>
          </section>

          {/* Tutorial */}
          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">App Tour</h2>
              <p class="settings-heading-desc">
                Replay the first-time tutorial walkthrough
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Restart Tutorial</div>
                  <div class="settings-desc">
                    Walk through the UI highlights again
                  </div>
                </div>
                <button
                  class="tutorial-restart-btn"
                  onClick={startTutorial}
                >
                  Restart Tour
                </button>
              </div>
            </div>
          </section>

          {/* Project Import / Export */}
          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">Project Config</h2>
              <p class="settings-heading-desc">
                Export or import project configuration and runs as a JSON file
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Export Project</div>
                  <div class="settings-desc">
                    Download this project's settings and runs as a portable JSON file
                  </div>
                </div>
                <button
                  class="settings-action-btn"
                  onClick={() => {
                    const config = { ...proj };
                    // Remove internal/volatile fields
                    delete config.syncMetadata;
                    const projectRuns = allRuns.value.filter(
                      (r) => r.projectId === proj.id,
                    );
                    const exportPayload = {
                      project: config,
                      runs: projectRuns,
                    };
                    const json = JSON.stringify(exportPayload, null, 2);
                    downloadFile(
                      json,
                      `${(proj.name || "project").replace(/\s+/g, "-")}-export.json`,
                      "application/json",
                    );
                  }}
                >
                  Export
                </button>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Import Project</div>
                  <div class="settings-desc">
                    Create a new project from an exported JSON file (config + runs)
                  </div>
                </div>
                <button
                  class="settings-action-btn"
                  onClick={() => {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".json";
                    input.onchange = async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      try {
                        const text = await file.text();
                        const parsed = JSON.parse(text);
                        // Support new format { project, runs } and legacy flat config
                        const config = parsed.project ? { ...parsed.project } : parsed;
                        const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
                        // Assign new ID
                        config.id = String(
                          Math.max(0, ...projectList.value.map((p) => Number(p.id) || 0)) + 1,
                        );
                        config.name = config.name
                          ? `${config.name} (imported)`
                          : "Imported Project";
                        delete config.syncMetadata;
                        await addProject(config);
                        // Import associated runs with updated projectId
                        for (const run of runs) {
                          await saveRun({ ...run, projectId: config.id });
                        }
                        if (runs.length > 0) await loadRuns();
                      } catch (err) {
                        console.error("Failed to import project:", err);
                      }
                    };
                    input.click();
                  }}
                >
                  Import
                </button>
              </div>
            </div>
          </section>

          {/* Danger Zone */}
          <section class="settings-section">
            <div class="settings-danger">
              <div class="settings-danger-header">
                <h2 class="settings-heading">Danger Zone</h2>
              </div>
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Delete this project</div>
                  <div class="settings-desc">
                    Once deleted, this project and all associated data cannot be
                    recovered.
                  </div>
                </div>
                <button
                  class="settings-danger-btn"
                  disabled={locked}
                  onClick={() => openDeleteDialog(proj.id)}
                >
                  <span dangerouslySetInnerHTML={{ __html: trashIcon }} />
                  Delete Project
                </button>
              </div>
              {draft.powerUserMode && <ClearAllDataRow />}
            </div>
          </section>

        </>
      )}

      {/* ─── Advanced Training Tab ─── */}
      {activeTab === "advanced" && draft.powerUserMode && (
        <>
          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">Training Basics</h2>
              <p class="settings-heading-desc">
                Core hyperparameters for the training loop
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row settings-row-grid">
                <label class="settings-field">
                  <span class="settings-label">Max Epochs</span>
                  <span class="settings-hint">Number of training epochs</span>
                  <input
                    class="settings-input"
                    type="number"
                    min="1"
                    value={draft.maxEpochs}
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "maxEpochs",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
                <label class="settings-field">
                  <span class="settings-label">Learning Rate</span>
                  <span class="settings-hint">
                    Leave empty for AutoTimm default
                  </span>
                  <input
                    class="settings-input"
                    type="number"
                    step="any"
                    value={draft.learningRate}
                    placeholder="auto"
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "learningRate",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
                <label class="settings-field">
                  <span class="settings-label">Batch Size</span>
                  <span class="settings-hint">Samples per training step</span>
                  <input
                    class="settings-input"
                    type="number"
                    min="1"
                    value={draft.batchSize}
                    placeholder="auto"
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "batchSize",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row settings-row-grid">
                <label class="settings-field">
                  <span class="settings-label">Weight Decay</span>
                  <span class="settings-hint">L2 regularization factor</span>
                  <input
                    class="settings-input"
                    type="number"
                    step="any"
                    value={draft.weightDecay}
                    placeholder="auto"
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "weightDecay",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row settings-row-grid">
                <label class="settings-field">
                  <span class="settings-label">Optimizer</span>
                  <span class="settings-hint">Optimization algorithm</span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.optimizer}
                      disabled={locked}
                      onChange={(e) => set("optimizer", e.target.value)}
                    >
                      <option value="">Auto (default)</option>
                      <option value="adamw">AdamW</option>
                      <option value="adam">Adam</option>
                      <option value="sgd">SGD</option>
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                </label>
                <label class="settings-field">
                  <span class="settings-label">Scheduler</span>
                  <span class="settings-hint">Learning rate schedule</span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.scheduler}
                      disabled={locked}
                      onChange={(e) => set("scheduler", e.target.value)}
                    >
                      <option value="">Auto (default)</option>
                      <option value="cosine">Cosine</option>
                      <option value="step">Step</option>
                      <option value="onecycle">OneCycle</option>
                      <option value="none">None</option>
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Early Stopping</div>
                  <div class="settings-desc">
                    Halt training after patience epochs with no improvement
                  </div>
                </div>
                <button
                  class="settings-theme-btn"
                  disabled={locked}
                  onClick={() => set("earlyStopping", !draft.earlyStopping)}
                >
                  {draft.earlyStopping ? "On" : "Off"}
                </button>
              </div>
              {draft.earlyStopping && (
                <>
                  <div class="settings-card-divider" />
                  <div class="settings-card-row settings-row-grid">
                    <label class="settings-field">
                      <span class="settings-label">Monitor Metric</span>
                      <span class="settings-hint">
                        Metric to watch for improvement
                      </span>
                      <div class="settings-select-wrap">
                        <select
                          class="settings-select"
                          value={draft.earlyStoppingMonitor}
                          disabled={locked}
                          onChange={(e) =>
                            set("earlyStoppingMonitor", e.target.value)
                          }
                        >
                          <option value="val/loss">Validation Loss</option>
                          <option value="val/accuracy">
                            Validation Accuracy
                          </option>
                        </select>
                        <span class="settings-select-chevron" />
                      </div>
                    </label>
                    <label class="settings-field">
                      <span class="settings-label">Patience</span>
                      <span class="settings-hint">
                        Epochs to wait before stopping (default 10)
                      </span>
                      <input
                        class="settings-input"
                        type="number"
                        min="1"
                        value={draft.earlyStoppingPatience}
                        placeholder="10"
                        disabled={locked}
                        onInput={(e) =>
                          set(
                            "earlyStoppingPatience",
                            e.target.value === "" ? "" : Number(e.target.value),
                          )
                        }
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">Precision & Data</h2>
              <p class="settings-heading-desc">
                Mixed precision, image size, and augmentation
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row settings-row-grid">
                <label class="settings-field">
                  <span class="settings-label">Precision</span>
                  <span class="settings-hint">Floating-point precision</span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.precision}
                      disabled={locked}
                      onChange={(e) => set("precision", e.target.value)}
                    >
                      <option value="">Auto (default)</option>
                      <option value="32">32-bit (float32)</option>
                      <option value="16-mixed">16-mixed (AMP)</option>
                      <option value="bf16-mixed">bf16-mixed</option>
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                </label>
                <label class="settings-field">
                  <span class="settings-label">Image Size</span>
                  <span class="settings-hint">Input resolution (px)</span>
                  <input
                    class="settings-input"
                    type="number"
                    min="1"
                    value={draft.imageSize}
                    placeholder="auto"
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "imageSize",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row settings-row-grid">
                <label class="settings-field">
                  <span class="settings-label">Augmentation Preset</span>
                  <span class="settings-hint">Data augmentation strategy</span>
                  <div class="settings-select-wrap">
                    <select
                      class="settings-select"
                      value={draft.augmentationPreset}
                      disabled={locked}
                      onChange={(e) =>
                        set("augmentationPreset", e.target.value)
                      }
                    >
                      <option value="">Auto (default)</option>
                      <option value="default">Default</option>
                      <option value="autoaugment">AutoAugment</option>
                      <option value="randaugment">RandAugment</option>
                      <option value="trivialaugment">TrivialAugment</option>
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                  <button
                    type="button"
                    class="settings-action-btn"
                    style="margin-top:6px"
                    onClick={() => setAugPreviewOpen(true)}
                    disabled={locked}
                  >
                    Preview
                  </button>
                </label>
                <label class="settings-field">
                  <span class="settings-label">Gradient Clip</span>
                  <span class="settings-hint">Max gradient norm</span>
                  <input
                    class="settings-input"
                    type="number"
                    step="any"
                    value={draft.gradientClipVal}
                    placeholder="auto"
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "gradientClipVal",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-header">
              <h2 class="settings-heading">Advanced</h2>
              <p class="settings-heading-desc">
                Backbone freezing and reproducibility
              </p>
            </div>
            <div class="settings-card">
              <div class="settings-card-row settings-row-between">
                <div>
                  <div class="settings-label">Freeze Backbone</div>
                  <div class="settings-desc">
                    Freeze pretrained backbone weights during training
                  </div>
                </div>
                <button
                  class="settings-theme-btn"
                  disabled={locked}
                  onClick={() => set("freezeBackbone", !draft.freezeBackbone)}
                >
                  {draft.freezeBackbone ? "On" : "Off"}
                </button>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Seed</span>
                  <span class="settings-hint">
                    Random seed for reproducibility (leave empty for random)
                  </span>
                  <input
                    class="settings-input"
                    type="number"
                    min="0"
                    value={draft.seed}
                    placeholder="random"
                    disabled={locked}
                    onInput={(e) =>
                      set(
                        "seed",
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                  />
                </label>
              </div>
              <div class="settings-card-divider" />
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Accelerator</span>
                  <div class="settings-select-wrap">
                    <select class="settings-select" value={draft.accelerator || (draft.gpuDevices ? "cuda" : "auto")} disabled={locked}
                      onChange={(e) => { set("accelerator", e.target.value); if (e.target.value !== "cuda") set("gpuDevices", ""); }}>
                      <option value="auto">Auto (training machine)</option>
                      <option value="cuda">NVIDIA CUDA</option>
                      <option value="mps">Apple Metal (MPS)</option>
                      <option value="cpu">CPU (Intel, AMD, Apple silicon)</option>
                    </select>
                    <span class="settings-select-chevron" />
                  </div>
                </label>
              </div>
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">Data-loader workers</span>
                  <input class="settings-input" type="number" min="0" value={draft.numWorkers} placeholder="AutoTimm default" disabled={locked}
                    onInput={(e) => set("numWorkers", e.target.value === "" ? "" : Number(e.target.value))} />
                </label>
              </div>
              <div class="settings-card-row settings-row-between">
                <div><div class="settings-label">Compile model</div><div class="settings-desc">Optional optimization; leave off for portable CPU and Metal execution.</div></div>
                <button class="settings-theme-btn" disabled={locked} onClick={() => set("compileModel", !draft.compileModel)}>{draft.compileModel ? "On" : "Off"}</button>
              </div>
              <div class="settings-card-row">
                <label class="settings-field">
                  <span class="settings-label">GPU Devices</span>
                  <span class="settings-hint">
                    CUDA device indices, e.g. 0 or 0,1. Clear for CPU, Metal, or Auto.
                  </span>
                  <input
                    class="settings-input"
                    type="text"
                    value={draft.gpuDevices}
                    placeholder="auto"
                    disabled={locked}
                    onInput={(e) => set("gpuDevices", e.target.value)}
                  />
                </label>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Save bar */}
      <div class={`settings-save-bar ${dirty || saved ? "visible" : ""}`}>
        {saved ? (
          <div class="settings-saved-msg">
            <span dangerouslySetInnerHTML={{ __html: checkIcon }} />
            Changes saved
          </div>
        ) : (
          <>
            <span class="settings-save-hint">You have unsaved changes</span>
            <div class="settings-save-actions">
              <button class="settings-discard-btn" onClick={handleDiscard}>
                Discard
              </button>
              <button
                class="settings-save-btn"
                disabled={locked}
                onClick={handleSave}
              >
                Save Changes
              </button>
            </div>
          </>
        )}
      </div>

      <DeleteProjectDialog />

      {augPreviewOpen && (
        <div class="modal-overlay" onClick={() => setAugPreviewOpen(false)}>
          <div class="modal" onClick={(e) => e.stopPropagation()} style="max-width:640px">
            <div class="modal-header">
              <h3>Augmentation Preview</h3>
              <button class="modal-close" onClick={() => setAugPreviewOpen(false)}>&times;</button>
            </div>
            <div class="modal-body">
              <p class="settings-hint" style="margin-bottom:12px">
                Preset: <strong>{draft.augmentationPreset || "Auto (default)"}</strong>
              </p>
              {!augSourceImage ? (
                <label class="aug-preview-upload">
                  <input
                    type="file"
                    accept="image/*"
                    style="display:none"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        const b64 = reader.result.split(",")[1];
                        setAugSourceImage(b64);
                        setAugPreviewLoading(true);
                        setAugPreviewError(null);
                        invoke("preview_augmentation", {
                          projectPath: proj.projectPath,
                          imageBase64: b64,
                          preset: draft.augmentationPreset || "default",
                          sshCommand:
                            proj.connectionType === "remote" ? proj.sshCommand : null,
                        })
                          // The command resolves to the array of base64 images itself.
                          .then((images) => setAugPreviewImages(images || []))
                          .catch((err) => {
                            setAugPreviewImages([]);
                            setAugPreviewError(
                              typeof err === "string" ? err : err?.message || "Preview failed",
                            );
                          })
                          .finally(() => setAugPreviewLoading(false));
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                  Click to upload a sample image
                </label>
              ) : (
                <>
                  <button
                    class="settings-action-btn"
                    style="margin-bottom:12px"
                    onClick={() => {
                      setAugSourceImage(null);
                      setAugPreviewImages([]);
                      setAugPreviewError(null);
                    }}
                  >
                    Choose different image
                  </button>
                  {augPreviewLoading ? (
                    <p class="settings-hint">Generating augmented images...</p>
                  ) : augPreviewError ? (
                    <p class="settings-hint settings-hint-error">{augPreviewError}</p>
                  ) : augPreviewImages.length > 0 ? (
                    <div class="aug-preview-grid">
                      {augPreviewImages.map((img, i) => (
                        <img
                          key={i}
                          class="aug-preview-img"
                          src={`data:image/png;base64,${img}`}
                          alt={`Augmented ${i + 1}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <p class="settings-hint">No augmented images generated. Ensure the project environment is set up.</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

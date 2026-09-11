import { signal, computed, effect } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import { projectRuns } from "./experiments.js";
import { currentProject } from "./projects.js";

export const INTERPRETATION_METHODS = [
  { id: "gradcam", label: "GradCAM", desc: "Class activation mapping" },
  { id: "gradcampp", label: "GradCAM++", desc: "Better for multiple objects" },
  {
    id: "integrated_gradients",
    label: "Integrated Gradients",
    desc: "Pixel-level attribution",
  },
  { id: "smoothgrad", label: "SmoothGrad", desc: "Noise-reduced gradients" },
  {
    id: "attention_rollout",
    label: "Attention Rollout",
    desc: "For Vision Transformers",
  },
  {
    id: "attention_flow",
    label: "Attention Flow",
    desc: "Transformer attention flow",
  },
];

// All completed runs for the current project
const allCompletedRuns = computed(() =>
  projectRuns.value.filter((r) => r.status === "completed"),
);

// Set of run IDs that have a checkpoint on disk
const _runIdsWithCheckpoint = signal(new Set());

// Reactively check which completed runs actually have checkpoints
effect(() => {
  const project = currentProject.value;
  const runs = allCompletedRuns.value;
  if (!project?.projectPath || runs.length === 0) {
    _runIdsWithCheckpoint.value = new Set();
    return;
  }

  let cancelled = false;
  const runIds = runs.map((r) => r.id);
  const sshCommand =
    project.connectionType === "remote" ? project.sshCommand : null;
  invoke("check_runs_checkpoints", {
    projectPath: project.projectPath,
    runIds,
    sshCommand,
  })
    .then((idsWithCkpt) => {
      if (!cancelled) _runIdsWithCheckpoint.value = new Set(idsWithCkpt);
    })
    .catch(() => {
      if (!cancelled) _runIdsWithCheckpoint.value = new Set();
    });
  return () => { cancelled = true; };
});

// Only runs that have a checkpoint on disk
export const completedRuns = computed(() =>
  allCompletedRuns.value.filter((r) => _runIdsWithCheckpoint.value.has(r.id)),
);

export const selectedRunId = signal("");
export const selectedRun = computed(
  () => completedRuns.value.find((r) => r.id === selectedRunId.value) || null,
);

export const uploadedImage = signal(null);
export const selectedMethod = signal("gradcam");

export const interpretationLoading = signal(false);
export const interpretationError = signal(null);
export const interpretationResult = signal(null);

export function selectRun(id) {
  selectedRunId.value = id;
}

export function setMethod(id) {
  selectedMethod.value = id;
}

export function setImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    uploadedImage.value = { name: file.name, url: e.target.result };
  };
  reader.readAsDataURL(file);
}

export function clearImage() {
  uploadedImage.value = null;
  interpretationResult.value = null;
  interpretationError.value = null;
}

export async function runInterpretation() {
  const run = selectedRun.value;
  const project = currentProject.value;
  const image = uploadedImage.value;

  if (!run || !project || !image) return;

  interpretationLoading.value = true;
  interpretationError.value = null;
  interpretationResult.value = null;

  try {
    const projectPath = project.projectPath;
    const runId = run.id;
    const sshCommand =
      project.connectionType === "remote" ? project.sshCommand : null;

    // Save the uploaded image to disk
    const imagePath = await invoke("save_interpretation_image", {
      projectPath,
      runId,
      imageBase64: image.url,
    });

    // Determine task class from project settings
    const taskClassMap = {
      Classification: "ImageClassifier",
      "Multi-Label Classification": "ImageClassifier",
      "Object Detection":
        project.detectionArch === "yolox" ? "YOLOXDetector" : "ObjectDetector",
      "Semantic Segmentation": "SemanticSegmentor",
      "Instance Segmentation": "InstanceSegmentor",
    };
    const taskClass = taskClassMap[project.taskType] || "ImageClassifier";

    // Run interpretation
    const result = await invoke("run_interpretation", {
      projectPath,
      runId,
      imagePath,
      methods: INTERPRETATION_METHODS.map((m) => m.id),
      taskClass,
      sshCommand,
    });

    // Surface top-level error from Python script failure
    if (result.error) {
      interpretationError.value = result.error;
    }

    interpretationResult.value = result;
  } catch (err) {
    interpretationError.value =
      typeof err === "string" ? err : err.message || "Interpretation failed";
  } finally {
    interpretationLoading.value = false;
  }
}

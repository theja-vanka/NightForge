import { signal, computed } from "@preact/signals";
import {
  getAllProjects,
  saveProject,
  updateProject as dbUpdateProject,
  deleteProject as dbDeleteProject,
  migrateProjectIds,
} from "../db/database.js";
import { restoreSyncState, platform, cleanupProjectState } from "./dashboard.js";

export const projectList = signal([]);
export const currentProjectId = signal(null);

// Load projects from database on initialization
export async function loadProjects() {
  try {
    // Migrate old proj-<timestamp> IDs to sequential integers (1, 2, 3, …)
    await migrateProjectIds();
    const projects = await getAllProjects();
    // Add default values for fields that might not exist in older projects
    const updatedProjects = projects.map((p) => {
      // Determine task type (use existing or default)
      const taskType = p.taskType || "Classification";

      // Set appropriate dataset format default based on task type
      let defaultFormat = "";
      if (!p.datasetFormat) {
        if (taskType === "Classification") defaultFormat = "Folder";
        else if (taskType === "Multi-Label Classification")
          defaultFormat = "CSV";
        else if (taskType === "Object Detection") defaultFormat = "COCO JSON";
        else if (taskType === "Semantic Segmentation")
          defaultFormat = "PNG Masks";
        else if (taskType === "Instance Segmentation")
          defaultFormat = "COCO JSON";
      }

      // Only add defaults for fields that don't exist
      // Migrate old paths to ~/nightflow/projects/
      let projectPath = p.projectPath;
      if (projectPath && projectPath.startsWith("/opt/nightflow/")) {
        projectPath = projectPath.replace(
          "/opt/nightflow/",
          "~/nightflow/projects/",
        );
      } else if (
        projectPath &&
        projectPath.startsWith("~/NightFlow/projects")
      ) {
        projectPath = projectPath.replace(
          "~/NightFlow/projects",
          "~/nightflow/projects",
        );
      }

      return {
        ...p, // Keep all existing fields
        projectPath: projectPath || "~/nightflow/projects",
        // Add missing fields with defaults (these won't override existing values due to || operator)
        ...(!p.connectionType && { connectionType: "localhost" }),
        ...(!p.sshCommand && { sshCommand: "localhost" }),
        ...(!p.taskType && { taskType: "Classification" }),
        ...(!p.modelCategory && { modelCategory: "Edge" }),
        ...(!p.detectionArch && { detectionArch: "fcos" }),
        ...(!p.segHeadType && { segHeadType: "deeplabv3plus" }),
        ...(!p.datasetFormat && { datasetFormat: defaultFormat }),
        ...(!p.folderPath && { folderPath: "" }),
        ...(!p.trainPath && { trainPath: "" }),
        ...(!p.valPath && { valPath: "" }),
        ...(!p.testPath && { testPath: "" }),
        ...(p.powerUserMode === undefined && { powerUserMode: false }),
        ...(p.maxEpochs === undefined && { maxEpochs: 10 }),
        ...(p.learningRate === undefined && { learningRate: "" }),
        ...(p.batchSize === undefined && { batchSize: "" }),
        ...(p.optimizer === undefined && { optimizer: "" }),
        ...(p.scheduler === undefined && { scheduler: "" }),
        ...(p.weightDecay === undefined && { weightDecay: "" }),
        ...(p.precision === undefined && { precision: "" }),
        ...(p.gradientClipVal === undefined && { gradientClipVal: "" }),
        ...(p.imageSize === undefined && { imageSize: "" }),
        ...(p.augmentationPreset === undefined && { augmentationPreset: "" }),
        ...(p.freezeBackbone === undefined && { freezeBackbone: false }),
        ...((p.seed === undefined) && { seed: 42 }),
        ...(p.earlyStopping === undefined && { earlyStopping: false }),
        ...(p.earlyStoppingPatience === undefined && {
          earlyStoppingPatience: "",
        }),
        ...(p.earlyStoppingMonitor === undefined && {
          earlyStoppingMonitor: "val/loss",
        }),
        ...(p.gpuDevices === undefined && { gpuDevices: "" }),
      };
    });
    projectList.value = updatedProjects;
    if (updatedProjects.length > 0 && !currentProjectId.value) {
      currentProjectId.value = updatedProjects[0].id;
      restoreSyncState(updatedProjects[0].id);
    }
  } catch (error) {
    console.error("Failed to load projects:", error);
  }
}

export const currentProject = computed(
  () => projectList.value.find((p) => p.id === currentProjectId.value) || null,
);

// ── Wizard constants (derived from AutoTimm API) ──

export const TASK_TYPES = [
  {
    id: "Classification",
    label: "Classification",
    desc: "Assign a single label to each image",
  },
  {
    id: "Multi-Label Classification",
    label: "Multi-Label Classification",
    desc: "Assign multiple labels per image",
  },
  {
    id: "Object Detection",
    label: "Object Detection",
    desc: "Locate and classify objects with bounding boxes",
  },
  {
    id: "Semantic Segmentation",
    label: "Semantic Segmentation",
    desc: "Label every pixel with a class",
  },
  {
    id: "Instance Segmentation",
    label: "Instance Segmentation",
    desc: "Separate individual object instances at pixel level",
  },
];

export { MODEL_CATEGORIES, DETECTION_ARCHS, YOLOX_MODEL_CATEGORIES, DETECTION_MODEL_CATEGORIES, SEGMENTATION_MODEL_CATEGORIES, SEG_HEAD_TYPES } from "../utils/modelCatalog.js";

// Dataset formats per task
export const DATASET_FORMATS = {
  Classification: [
    {
      id: "Folder",
      label: "Folder",
      desc: "Subdirectory per class (ImageFolder)",
    },
    {
      id: "CSV",
      label: "CSV",
      desc: "Comma-separated file with image paths and labels",
    },
  ],
  "Multi-Label Classification": [
    { id: "CSV", label: "CSV", desc: "Image path column followed by one 0/1 column per label" },
    { id: "JSONL", label: "JSONL", desc: "JSON objects with label arrays" },
  ],
  "Object Detection": [
    {
      id: "COCO JSON",
      label: "COCO JSON",
      desc: "Standard COCO format with annotations and categories",
    },
    {
      id: "CSV",
      label: "CSV",
      desc: "Rows with image path, bounding box, and label",
    },
  ],
  "Semantic Segmentation": [
    {
      id: "PNG Masks",
      label: "PNG Masks",
      desc: "Pixel-value masks matching image filenames",
    },
    {
      id: "COCO",
      label: "COCO",
      desc: "COCO panoptic format with segmentation polygons",
    },
    {
      id: "Cityscapes",
      label: "Cityscapes",
      desc: "City-based folder layout with label ID masks",
    },
    {
      id: "VOC",
      label: "VOC",
      desc: "Pascal VOC layout with SegmentationClass masks",
    },
    { id: "CSV", label: "CSV", desc: "Image path to mask path mapping" },
  ],
  "Instance Segmentation": [
    {
      id: "COCO JSON",
      label: "COCO JSON",
      desc: "COCO format with per-instance polygons and bboxes",
    },
    {
      id: "CSV",
      label: "CSV",
      desc: "Rows with image, mask path, label, and instance ID",
    },
  ],
};

// Open-source datasets per task for testing
export const OPENSOURCE_DATASETS = {
  Classification: [
    {
      name: "ImageNet-1K",
      desc: "1.28M images, 1000 classes",
      format: "Folder",
    },
    { name: "CIFAR-10", desc: "60K images, 10 classes", format: "Folder" },
    { name: "CIFAR-100", desc: "60K images, 100 classes", format: "Folder" },
    {
      name: "Oxford Flowers-102",
      desc: "8K images, 102 flower species",
      format: "Folder",
    },
    {
      name: "Stanford Cars",
      desc: "16K images, 196 car models",
      format: "Folder",
    },
  ],
  "Multi-Label Classification": [
    {
      name: "Pascal VOC 2012",
      desc: "11K images, 20 object classes",
      format: "CSV",
    },
    {
      name: "MS-COCO Multi-Label",
      desc: "123K images, 80 categories",
      format: "CSV",
    },
    { name: "NUS-WIDE", desc: "270K images, 81 concepts", format: "CSV" },
  ],
  "Object Detection": [
    {
      name: "MS-COCO 2017",
      desc: "118K train images, 80 categories",
      format: "COCO JSON",
    },
    { name: "Pascal VOC 2012", desc: "11K images, 20 classes", format: "CSV" },
    {
      name: "Open Images v7",
      desc: "1.9M images, 600 classes",
      format: "COCO JSON",
    },
  ],
  "Semantic Segmentation": [
    {
      name: "ADE20K",
      desc: "25K images, 150 semantic classes",
      format: "PNG Masks",
    },
    {
      name: "Cityscapes",
      desc: "5K fine-annotated urban scenes",
      format: "Cityscapes",
    },
    { name: "Pascal VOC 2012", desc: "2.9K segmentation masks", format: "VOC" },
  ],
  "Instance Segmentation": [
    {
      name: "MS-COCO 2017",
      desc: "118K images, 80 categories",
      format: "COCO JSON",
    },
    {
      name: "LVIS v1",
      desc: "164K images, 1203 categories",
      format: "COCO JSON",
    },
    {
      name: "Cityscapes",
      desc: "5K fine instance annotations",
      format: "COCO JSON",
    },
  ],
};

// ── Wizard state ──

const defaultData = {
  connectionType: "localhost",
  sshCommand: "localhost",
  name: "",
  projectPath: "",
  taskType: "Classification",
  modelCategory: "Edge",
  detectionArch: "fcos",
  segHeadType: "deeplabv3plus",
  datasetFormat: "Folder",
  openSourceDataset: "",
  folderPath: "",
  trainPath: "",
  valPath: "",
  testPath: "",
  imageFolderPath: "",
  imageColumn: "",
  labelColumn: "",
  labelColumns: "",
  numClasses: "",
  classNames: [],
  powerUserMode: false,
  maxEpochs: 10,
  learningRate: "",
  batchSize: "",
  optimizer: "",
  scheduler: "",
  weightDecay: "",
  precision: "",
  gradientClipVal: "",
  imageSize: "",
  augmentationPreset: "",
  freezeBackbone: false,
  seed: 42,
  earlyStopping: true,
  earlyStoppingPatience: "",
  earlyStoppingMonitor: "val/loss",
  gpuDevices: "",
  accelerator: "auto",
  numWorkers: "",
  compileModel: false,
};

export const STEP_COUNT = 6;

export const wizardOpen = signal(false);
export const wizardStep = signal(0);
export const wizardData = signal({ ...defaultData });
export const wizardCwd = signal("");

// Path validation error signals
export const trainPathError = signal("");
export const valPathError = signal("");
export const testPathError = signal("");

export const STEP_LABELS = [
  "SSH",
  "Name",
  "Task",
  "Backbone",
  "Dataset",
  "Confirm",
];

export const wizardCanProceed = computed(() => {
  const d = wizardData.value;
  const step = wizardStep.value;
  if (step === 0) {
    // For remote instance, require SSH command
    if (d.connectionType === "remote") {
      return d.sshCommand.trim().length > 0;
    }
    // Localhost is always valid
    return true;
  }
  if (step === 1) return d.name.trim().length > 0;
  if (step === 2) return d.taskType !== "";
  if (step === 3) return d.modelCategory !== "";
  if (step === 4) {
    if (!d.datasetFormat) return false;
    // Require numClasses for all formats
    const hasClasses = d.numClasses !== "" && Number.isInteger(Number(d.numClasses)) && d.numClasses >= (d.taskType === "Classification" ? 2 : 1);
    // For CSV and JSONL, require train and test paths (val is optional)
    if (d.datasetFormat === "CSV" || d.datasetFormat === "JSONL") {
      return (
        hasClasses &&
        d.trainPath.trim().length > 0 &&
        d.testPath.trim().length > 0
      );
    }
    // For all other formats (Folder, COCO JSON, COCO, PNG Masks, Cityscapes, VOC, etc.)
    // require folder path (no external validation enforced here)
    return hasClasses && d.folderPath.trim().length > 0;
  }
  if (step === 5) return true;
  return false;
});

const projectBasePath = () => platform.value === "windows" ? "~\\nightflow\\projects\\" : "~/nightflow/projects/";

export async function openWizard() {
  const basePath = projectBasePath();
  wizardCwd.value = basePath;
  wizardData.value = { ...defaultData, projectPath: basePath };
  wizardStep.value = 0;
  wizardOpen.value = true;
  // Reset validation errors
  trainPathError.value = "";
  valPathError.value = "";
  testPathError.value = "";
}

export function closeWizard() {
  wizardOpen.value = false;
  // Reset validation errors
  trainPathError.value = "";
  valPathError.value = "";
  testPathError.value = "";
}

export function wizardNext() {
  if (!wizardCanProceed.value) return;
  if (wizardStep.value < STEP_COUNT - 1) {
    wizardStep.value = wizardStep.value + 1;
  }
}

export function wizardBack() {
  if (wizardStep.value > 0) {
    wizardStep.value = wizardStep.value - 1;
  }
}

export function wizardSetField(field, value) {
  wizardData.value = { ...wizardData.value, [field]: value };
}

export async function addProject(project) {
  try {
    await saveProject(project);
    projectList.value = [...projectList.value, project];
    currentProjectId.value = project.id;
  } catch (error) {
    console.error("Failed to save project:", error);
    throw error;
  }
}

export async function wizardCreate() {
  if (!wizardCanProceed.value) return;
  const d = wizardData.value;
  const project = {
    id: String(
      Math.max(0, ...projectList.value.map((p) => Number(p.id) || 0)) + 1,
    ),
    connectionType: d.connectionType,
    sshCommand: d.sshCommand.trim(),
    name: d.name.trim(),
    projectPath: d.projectPath.trim().replace(/\/*$/, "/"),
    taskType: d.taskType,
    modelCategory: d.modelCategory,
    detectionArch: d.detectionArch,
    segHeadType: d.segHeadType,
    datasetFormat: d.datasetFormat,
    folderPath: d.folderPath.trim()
      ? d.folderPath.trim().replace(/\/*$/, "/")
      : "",
    trainPath: d.trainPath.trim(),
    valPath: d.valPath.trim(),
    testPath: d.testPath.trim(),
    imageFolderPath: d.imageFolderPath.trim()
      ? d.imageFolderPath.trim().replace(/\/*$/, "/")
      : "",
    imageColumn: d.imageColumn.trim(),
    labelColumn: d.labelColumn.trim(),
    labelColumns: d.labelColumns.trim(),
    numClasses: d.numClasses !== "" ? d.numClasses : "",
    classNames: Array.isArray(d.classNames) ? d.classNames : [],
    powerUserMode: false,
    maxEpochs: 10,
    learningRate: "",
    batchSize: "",
    optimizer: "",
    scheduler: "",
    weightDecay: "",
    precision: "",
    gradientClipVal: "",
    imageSize: "",
    augmentationPreset: "",
    freezeBackbone: false,
    seed: 42,
    earlyStopping: true,
    earlyStoppingPatience: "",
    earlyStoppingMonitor: "val/loss",
  };
  await addProject(project);
  closeWizard();
}

export async function updateProject(id, fields) {
  try {
    await dbUpdateProject(id, fields);
    projectList.value = projectList.value.map((p) =>
      p.id === id ? { ...p, ...fields } : p,
    );
  } catch (error) {
    console.error("Failed to update project:", error);
    throw error;
  }
}

export function selectProject(id) {
  currentProjectId.value = id;
  restoreSyncState(id);
}

// ── Delete project state ──

export const deleteDialogOpen = signal(false);
export const deleteTargetId = signal(null);
export const deleteConfirmText = signal("");

export const deleteTarget = computed(
  () => projectList.value.find((p) => p.id === deleteTargetId.value) || null,
);

export const deleteConfirmed = computed(
  () => deleteConfirmText.value.toLowerCase() === "delete",
);

export function openDeleteDialog(id) {
  deleteTargetId.value = id;
  deleteConfirmText.value = "";
  deleteDialogOpen.value = true;
}

export function closeDeleteDialog() {
  deleteDialogOpen.value = false;
  deleteTargetId.value = null;
  deleteConfirmText.value = "";
}

export async function confirmDeleteProject() {
  if (!deleteConfirmed.value) return;
  const id = deleteTargetId.value;
  try {
    await dbDeleteProject(id);
    cleanupProjectState(id);
    const list = projectList.value.filter((p) => p.id !== id);
    projectList.value = list;
    if (currentProjectId.value === id) {
      currentProjectId.value = list.length > 0 ? list[0].id : null;
    }
    closeDeleteDialog();
  } catch (error) {
    console.error("Failed to delete project:", error);
    throw error;
  }
}

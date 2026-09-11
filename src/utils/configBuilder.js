import { MODEL_CATEGORIES, YOLOX_MODEL_CATEGORIES, DETECTION_MODEL_CATEGORIES, SEGMENTATION_MODEL_CATEGORIES } from "./modelCatalog.js";

const quote = (value) => JSON.stringify(String(value));
const present = (value) => value !== "" && value !== undefined && value !== null;

const TASK_CLASS_PATHS = {
  Classification: {
    model: "autotimm.ImageClassifier",
    data: "autotimm.ImageDataModule",
  },
  "Multi-Label Classification": {
    model: "autotimm.ImageClassifier",
    data: "autotimm.MultiLabelImageDataModule",
  },
  "Object Detection": {
    model: "autotimm.ObjectDetector",
    data: "autotimm.DetectionDataModule",
  },
  "Object Detection::yolox": {
    model: "autotimm.YOLOXDetector",
    data: "autotimm.DetectionDataModule",
  },
  "Semantic Segmentation": {
    model: "autotimm.SemanticSegmentor",
    data: "autotimm.SegmentationDataModule",
  },
  "Instance Segmentation": {
    model: "autotimm.InstanceSegmentor",
    data: "autotimm.InstanceSegmentationDataModule",
  },
};

/**
 * Build an AutoTimm YAML config string from a NightFlow project object.
 */
export function buildConfigYaml(project, runId = "default") {
  validateTrainingProject(project);
  const task = project.taskType || "Classification";
  const isYolox = task === "Object Detection" && project.detectionArch === "yolox";
  const isFcosDetection = task === "Object Detection" && !isYolox;
  const isSeg = task === "Semantic Segmentation" || task === "Instance Segmentation";
  const pathKey = isYolox ? "Object Detection::yolox" : task;
  const paths = TASK_CLASS_PATHS[pathKey] || TASK_CLASS_PATHS[task] || TASK_CLASS_PATHS["Classification"];
  const category = project.modelCategory || "Edge";
  const modelSource = isYolox
    ? YOLOX_MODEL_CATEGORIES
    : isFcosDetection
      ? DETECTION_MODEL_CATEGORIES
      : isSeg
        ? SEGMENTATION_MODEL_CATEGORIES
        : MODEL_CATEGORIES;
  const backbone = modelSource[category]?.models?.[0] || (isYolox ? "yolox-s" : "efficientnet_b0");

  const lines = [];

  // ── model section ───────────────────────────────────────────────────────
  lines.push("model:");
  lines.push(`  class_path: ${paths.model}`);
  lines.push("  init_args:");
  lines.push(`    ${isYolox ? "model_name" : "backbone"}: ${backbone}`);

  if (present(project.seed)) {
    lines.unshift(`seed_everything: ${project.seed}`);
  }

  if (present(project.numClasses)) {
    lines.push(`    num_classes: ${project.numClasses}`);
  }

  if (present(project.learningRate)) {
    lines.push(`    lr: ${project.learningRate}`);
  }

  if (task === "Multi-Label Classification") {
    lines.push("    multi_label: true");
  }

  if (task === "Object Detection" && project.detectionArch && !isYolox) {
    lines.push(`    detection_arch: ${quote(project.detectionArch)}`);
  }

  if (task === "Semantic Segmentation" && project.segHeadType) {
    lines.push(`    head_type: ${quote(project.segHeadType)}`);
  }

  if (project.optimizer) {
    lines.push(`    optimizer: ${quote(project.optimizer)}`);
  }

  if (project.scheduler) {
    lines.push(`    scheduler: ${project.scheduler === "none" ? "null" : quote(project.scheduler)}`);
  }

  if (present(project.weightDecay)) {
    lines.push(`    weight_decay: ${project.weightDecay}`);
  }

  if (project.freezeBackbone && !isYolox) {
    lines.push("    freeze_backbone: true");
  }

  // Compilation is opt-in: AutoTimm defaults to compiling, which is not portable.
  lines.push(`    compile_model: ${project.compileModel === true}`);
  if (isYolox) lines.push(`    total_epochs: ${project.maxEpochs || 10}`);

  // Classification metrics
  if (
    (task === "Classification" || task === "Multi-Label Classification") &&
    present(project.numClasses)
  ) {
    const tmTask =
      task === "Multi-Label Classification" ? "multilabel" : "multiclass";
    const ncKey =
      task === "Multi-Label Classification" ? "num_labels" : "num_classes";
    const nc = project.numClasses;

    lines.push("    metrics:");

    const metricsDef = [
      { name: "accuracy", cls: "Accuracy", extra: {} },
      { name: "precision", cls: "Precision", extra: { average: "macro" } },
      { name: "recall", cls: "Recall", extra: { average: "macro" } },
      { name: "f1", cls: "F1Score", extra: { average: "macro" } },
    ];

    for (const m of metricsDef) {
      lines.push(`      - name: ${m.name}`);
      lines.push("        backend: torchmetrics");
      lines.push(`        metric_class: ${m.cls}`);

      // params as inline YAML mapping
      const paramParts = [`task: ${tmTask}`, `${ncKey}: ${nc}`];
      for (const [k, v] of Object.entries(m.extra)) {
        paramParts.push(`${k}: ${v}`);
      }
      lines.push(`        params: {${paramParts.join(", ")}}`);

      lines.push("        stages: [train, val, test]");
      lines.push("        prog_bar: true");
    }
  }

  // ── data section ────────────────────────────────────────────────────────
  lines.push("");
  lines.push("data:");
  lines.push(`  class_path: ${paths.data}`);
  lines.push("  init_args:");

  const fmt = project.datasetFormat;
  if (fmt === "CSV" || fmt === "JSONL") {
    if (project.trainPath)
      lines.push(`    train_csv: ${quote(project.trainPath)}`);
    if (project.valPath)
      lines.push(`    val_csv: ${quote(project.valPath)}`);
    if (project.testPath)
      lines.push(`    test_csv: ${quote(project.testPath)}`);
  } else if (project.folderPath) {
    lines.push(`    data_dir: ${quote(project.folderPath)}`);
  }

  if (fmt === "CSV" && task !== "Semantic Segmentation") {
    if (project.imageColumn?.trim()) lines.push(`    image_column: ${quote(project.imageColumn.trim())}`);
    if (task === "Multi-Label Classification") {
      const columns = (project.labelColumns || "").split(",").map((v) => v.trim()).filter(Boolean);
      if (columns.length) lines.push(`    label_columns: ${JSON.stringify(columns)}`);
    } else if (project.labelColumn?.trim()) {
      lines.push(`    label_column: ${quote(project.labelColumn.trim())}`);
    }
  }
  if (fmt === "CSV") {
    if (task === "Semantic Segmentation") {
      lines.push(`    data_dir: ${quote(project.imageFolderPath || project.folderPath || ".")}`);
    } else if (project.imageFolderPath) {
      lines.push(`    image_dir: ${quote(project.imageFolderPath)}`);
    }
  }
  if (task === "Semantic Segmentation") {
    const formats = { "PNG Masks": "png", COCO: "coco", Cityscapes: "cityscapes", VOC: "voc", CSV: "csv" };
    lines.push(`    format: ${quote(formats[fmt || "PNG Masks"])}`);
  }
  if (present(project.numWorkers)) lines.push(`    num_workers: ${project.numWorkers}`);

  if (present(project.batchSize)) {
    lines.push(`    batch_size: ${project.batchSize}`);
  }

  if (present(project.imageSize)) {
    lines.push(`    image_size: ${project.imageSize}`);
  }

  if (project.augmentationPreset) {
    lines.push(`    augmentation_preset: ${quote(project.augmentationPreset)}`);
  }

  // ── trainer section ─────────────────────────────────────────────────────
  lines.push("");
  lines.push("trainer:");
  lines.push(`  max_epochs: ${project.maxEpochs || 10}`);
  const accelerator = project.accelerator || (project.gpuDevices?.trim() ? "cuda" : "auto");
  lines.push(`  accelerator: ${accelerator}`);
  if (accelerator === "cuda" && project.gpuDevices?.trim()) {
    // AutoTrainer accepts a string; Lightning parses comma-separated CUDA IDs.
    lines.push(`  devices: ${quote(project.gpuDevices.split(",").map((s) => s.trim()).join(",") + (project.gpuDevices.includes(",") ? "" : ","))}`);
  } else {
    lines.push(`  devices: ${accelerator === "cpu" || accelerator === "mps" ? 1 : "auto"}`);
  }
  lines.push(`  precision: ${quote(project.precision || "32-true")}`);

  if (present(project.gradientClipVal)) {
    lines.push(`  gradient_clip_val: ${project.gradientClipVal}`);
  }

  // Early stopping callback
  if (project.earlyStopping) {
    const monitor = project.earlyStoppingMonitor || "val/loss";
    const patience = present(project.earlyStoppingPatience) ? project.earlyStoppingPatience : 10;
    const mode = monitor.includes("loss") ? "min" : "max";
    lines.push("  callbacks:");
    lines.push("    - class_path: pytorch_lightning.callbacks.EarlyStopping");
    lines.push("      init_args:");
    lines.push(`        monitor: ${quote(monitor)}`);
    lines.push(`        patience: ${patience}`);
    lines.push(`        mode: ${mode}`);
  }

  // Logger section
  lines.push("  logger:");
  lines.push("    - class_path: autotimm.core.loggers.LoggerConfig");
  lines.push("      init_args:");
  lines.push("        backend: csv");
  lines.push("        params:");
  lines.push("          save_dir: logs");
  lines.push(`          name: ${quote(runId)}`);
  lines.push('          version: ""');

  lines.push("");
  return lines.join("\n");
}

/** Reject configurations the training API cannot consume before writing a file. */
export function validateTrainingProject(project) {
  const task = project.taskType || "Classification";
  if (task === "Classification" && present(project.numClasses) && Number(project.numClasses) < 2) throw new Error("Single-label classification requires at least two classes.");
  if (!TASK_CLASS_PATHS[task]) throw new Error(`Unsupported task: ${task}`);
  if (project.datasetFormat === "JSONL") {
    throw new Error("AutoTimm's training data modules do not support JSONL. Convert the dataset to CSV and select CSV before training.");
  }
  const formats = {
    Classification: ["Folder", "CSV"],
    "Multi-Label Classification": ["CSV"],
    "Object Detection": ["COCO JSON", "CSV"],
    "Semantic Segmentation": ["PNG Masks", "COCO", "Cityscapes", "VOC", "CSV"],
    "Instance Segmentation": ["COCO JSON", "CSV"],
  };
  if (project.datasetFormat && !formats[task].includes(project.datasetFormat)) throw new Error("Dataset format is incompatible with the task.");
  if (project.datasetFormat === "CSV" && task !== "Semantic Segmentation") {
    const image = project.imageColumn?.trim();
    const labels = task === "Multi-Label Classification"
      ? (project.labelColumns || "").split(",").map((v) => v.trim()).filter(Boolean)
      : [project.labelColumn?.trim()].filter(Boolean);
    if (labels.includes(image)) throw new Error("Image path and label columns must be different.");
    if (new Set(labels).size !== labels.length) throw new Error("Label column names must be unique.");
  }
  const numbers = { numClasses: [1, true], maxEpochs: [1, true], batchSize: [1, true], imageSize: [1, true], numWorkers: [0, true], seed: [0, true], earlyStoppingPatience: [0, true], learningRate: [0, false], weightDecay: [0, false], gradientClipVal: [0, false] };
  for (const [key, [min, integer]] of Object.entries(numbers)) {
    if (!present(project[key])) continue;
    const value = Number(project[key]);
    if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${key}: ${project[key]}`);
  }
  const accelerator = project.accelerator || (project.gpuDevices?.trim() ? "cuda" : "auto");
  if (!["auto", "cuda", "mps", "cpu"].includes(accelerator)) throw new Error("Unsupported accelerator.");
  if (project.gpuDevices?.trim()) {
    const ids = project.gpuDevices.split(",").map((s) => s.trim());
    if (ids.some((s) => !/^\d+$/.test(s)) || new Set(ids.map(Number)).size !== ids.length) throw new Error("CUDA device IDs must be unique nonnegative integers separated by commas.");
    if (accelerator !== "cuda") throw new Error("CUDA device IDs require the NVIDIA CUDA accelerator. Clear GPU Devices for CPU, Metal, or Auto.");
  }
  if (accelerator === "mps" && ["64", "64-true"].includes(String(project.precision))) throw new Error("Metal does not support float64. Select 32-bit precision.");
}

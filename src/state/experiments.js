import { signal, computed } from "@preact/signals";
import { invoke } from "@tauri-apps/api/core";
import {
  currentProjectId,
  projectList,
  MODEL_CATEGORIES,
  YOLOX_MODEL_CATEGORIES,
  DETECTION_MODEL_CATEGORIES,
  SEGMENTATION_MODEL_CATEGORIES,
} from "./projects.js";
import {
  getAllRuns,
  saveRun,
  updateRun as dbUpdateRun,
  deleteRun as dbDeleteRun,
} from "../db/database.js";

/**
 * Resolve the actual backbone/model name from a project's category and task type.
 * Mirrors the logic in configBuilder.js but returns just the model name string.
 */
export function resolveBackboneName(project) {
  if (!project) return "unknown";
  const task = project.taskType || "Classification";
  const isYolox = task === "Object Detection" && project.detectionArch === "yolox";
  const isFcos = task === "Object Detection" && !isYolox;
  const isSeg = task === "Semantic Segmentation" || task === "Instance Segmentation";
  const category = project.modelCategory || "Edge";
  const source = isYolox
    ? YOLOX_MODEL_CATEGORIES
    : isFcos
      ? DETECTION_MODEL_CATEGORIES
      : isSeg
        ? SEGMENTATION_MODEL_CATEGORIES
        : MODEL_CATEGORIES;
  return source[category]?.models?.[0] || (isYolox ? "yolox-s" : "efficientnet_b0");
}

export const allRuns = signal([]);

// MLflow run name generator — uses the exact word lists from mlflow/utils/name_utils.py
const _GENERATOR_PREDICATES = [
  "abundant", "able", "abrasive", "adorable", "adaptable", "adventurous",
  "aged", "agreeable", "ambitious", "amazing", "amusing", "angry",
  "auspicious", "awesome", "bald", "beautiful", "bemused", "bedecked",
  "big", "bittersweet", "blushing", "bold", "bouncy", "brawny", "bright",
  "burly", "bustling", "calm", "capable", "carefree", "capricious",
  "caring", "casual", "charming", "chill", "classy", "clean", "clumsy",
  "colorful", "crawling", "dapper", "debonair", "dashing", "defiant",
  "delicate", "delightful", "dazzling", "efficient", "enchanting",
  "entertaining", "enthused", "exultant", "fearless", "flawless",
  "fortunate", "fun", "funny", "gaudy", "gentle", "gifted", "glamorous",
  "grandiose", "gregarious", "handsome", "hilarious", "honorable",
  "illustrious", "incongruous", "indecisive", "industrious", "intelligent",
  "inquisitive", "intrigued", "invincible", "judicious", "kindly", "languid",
  "learned", "legendary", "likeable", "loud", "luminous", "luxuriant",
  "lyrical", "magnificent", "marvelous", "masked", "melodic", "merciful",
  "mercurial", "monumental", "mysterious", "nebulous", "nervous", "nimble",
  "nosy", "omniscient", "orderly", "overjoyed", "peaceful", "painted",
  "persistent", "placid", "polite", "popular", "powerful", "puzzled",
  "rambunctious", "rare", "rebellious", "respected", "resilient",
  "righteous", "receptive", "redolent", "rogue", "rumbling", "salty",
  "sassy", "secretive", "selective", "sedate", "serious", "shivering",
  "skillful", "sincere", "skittish", "silent", "smiling", "sneaky",
  "sophisticated", "spiffy", "stately", "suave", "stylish", "tasteful",
  "thoughtful", "thundering", "traveling", "treasured", "trusting",
  "unequaled", "upset", "unique", "unleashed", "useful", "upbeat",
  "unruly", "valuable", "vaunted", "victorious", "welcoming", "whimsical",
  "wistful", "wise", "worried", "youthful", "zealous",
];

const _GENERATOR_NOUNS = [
  "ant", "ape", "asp", "auk", "bass", "bat", "bear", "bee", "bird", "boar",
  "bug", "calf", "carp", "cat", "chimp", "cod", "colt", "conch", "cow",
  "crab", "crane", "croc", "crow", "cub", "deer", "doe", "dog", "dolphin",
  "donkey", "dove", "duck", "eel", "elk", "fawn", "finch", "fish", "flea",
  "fly", "foal", "fowl", "fox", "frog", "gnat", "gnu", "goat", "goose",
  "grouse", "grub", "gull", "hare", "hawk", "hen", "hog", "horse", "hound",
  "jay", "kit", "kite", "koi", "lamb", "lark", "loon", "lynx", "mare",
  "midge", "mink", "mole", "moose", "moth", "mouse", "mule", "newt", "owl",
  "ox", "panda", "penguin", "perch", "pig", "pug", "quail", "ram", "rat",
  "ray", "robin", "roo", "rook", "seal", "shad", "shark", "sheep", "shoat",
  "shrew", "shrike", "shrimp", "skink", "skunk", "sloth", "slug", "smelt",
  "snail", "snake", "snipe", "sow", "sponge", "squid", "squirrel", "stag",
  "steed", "stoat", "stork", "swan", "tern", "toad", "trout", "turtle",
  "vole", "wasp", "whale", "wolf", "worm", "wren", "yak", "zebra",
];

export function generateRunName() {
  const adj = _GENERATOR_PREDICATES[Math.floor(Math.random() * _GENERATOR_PREDICATES.length)];
  const noun = _GENERATOR_NOUNS[Math.floor(Math.random() * _GENERATOR_NOUNS.length)];
  const num = Math.floor(Math.random() * 1000); // 0–999, matching MLflow's integer_scale=1000
  return `${adj}-${noun}-${num}`;
}

// Load runs from database on initialization
export async function loadRuns() {
  try {
    const runs = await getAllRuns();
    allRuns.value = runs;
  } catch (error) {
    console.error("Failed to load runs:", error);
  }
}

// Add a new run
export async function addRun(run) {
  try {
    await saveRun(run);
    allRuns.value = [...allRuns.value, run];
  } catch (error) {
    console.error("Failed to save run:", error);
    throw error;
  }
}

// Update an existing run
export async function updateRun(id, updates) {
  try {
    await dbUpdateRun(id, updates);
    allRuns.value = allRuns.value.map((r) =>
      r.id === id ? { ...r, ...updates } : r,
    );
  } catch (error) {
    console.error("Failed to update run:", error);
    throw error;
  }
}

// Delete a run
export async function deleteRun(id) {
  try {
    await dbDeleteRun(id);
    allRuns.value = allRuns.value.filter((r) => r.id !== id);
  } catch (error) {
    console.error("Failed to delete run:", error);
    throw error;
  }
}

// Load scalars from a run's CSV file or JSONL file on disk and persist to IndexedDB
export async function loadRunScalars(run, force = false) {
  if (!run?.id) return null;

  // 0. Return cached scalars if available (unless forcing refresh)
  if (!force && run.scalars && Object.keys(run.scalars).length > 0) {
    return run.scalars;
  }

  const project = projectList.value.find((p) => p.id === run.projectId);
  if (!project?.projectPath) return null;

  try {
    // 1. Try CSV parser
    let csvScalars = await invoke("parse_csv_run", {
      projectPath: project.projectPath,
      runId: run.id,
    }).catch((err) => {
      console.warn(`CSV parsing failed for run ${run.id}:`, err);
      return null;
    });

    // 2. Try JSONL parser
    const jsonlScalars = await invoke("parse_run_jsonl", {
      projectPath: project.projectPath,
      runId: run.id,
    }).catch(() => null);

    // 3. Merge: for each tag, keep whichever source has more data points.
    //    CSVLogger can be overwritten when test runs as a separate process,
    //    losing train/val history — JSONL is append-only and more reliable.
    let scalars = null;
    if (csvScalars && jsonlScalars) {
      scalars = { ...csvScalars };
      for (const [tag, points] of Object.entries(jsonlScalars)) {
        if (!scalars[tag] || points.length > scalars[tag].length) {
          scalars[tag] = points;
        }
      }
    } else {
      scalars = jsonlScalars || csvScalars;
    }

    const updates = {};

    if (scalars && Object.keys(scalars).length > 0) {
      // Merge with existing persisted scalars (don't lose data already in DB)
      const existing = run.scalars || {};
      updates.scalars = { ...existing, ...scalars };
    }

    // 3. Also load hparams.yaml if not already cached
    if (!run.fileHparams || Object.keys(run.fileHparams).length === 0) {
      try {
        const hparams = await invoke("parse_hparams_yaml", {
          projectPath: project.projectPath,
          runId: run.id,
        });
        if (hparams && Object.keys(hparams).length > 0) {
          updates.fileHparams = hparams;
        }
      } catch {
        // hparams.yaml not found — that's fine
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateRun(run.id, updates);
      return updates.scalars || null;
    }
    return null;
  } catch (err) {
    console.error("Failed to load run scalars:", err);
    return null;
  }
}

// Load hparams from hparams.yaml on disk for a specific run
export async function loadRunHparams(run) {
  if (!run?.id) return null;

  // Return cached file-based hparams if available
  if (run.fileHparams && Object.keys(run.fileHparams).length > 0) {
    return run.fileHparams;
  }

  const project = projectList.value.find((p) => p.id === run.projectId);
  if (!project?.projectPath) return null;

  try {
    const hparams = await invoke("parse_hparams_yaml", {
      projectPath: project.projectPath,
      runId: run.id,
    });
    if (hparams && Object.keys(hparams).length > 0) {
      await updateRun(run.id, { fileHparams: hparams });
      return hparams;
    }
    return null;
  } catch {
    return null;
  }
}

export const projectRuns = computed(() =>
  allRuns.value.filter((r) => r.projectId === currentProjectId.value),
);

export const filterText = signal("");
export const filterStatus = signal("all");
export const sortField = signal("created");
export const sortDir = signal("desc");

export const filteredRuns = computed(() => {
  let result = projectRuns.value;

  const q = filterText.value.toLowerCase();
  if (q) {
    result = result.filter(
      (r) =>
        (r.name && r.name.toLowerCase().includes(q)) ||
        String(r.id ?? "").toLowerCase().includes(q) ||
        String(r.model ?? "").toLowerCase().includes(q) ||
        String(r.dataset ?? "").toLowerCase().includes(q) ||
        (r.tags && r.tags.some((t) => t.toLowerCase().includes(q))),
    );
  }

  if (filterStatus.value !== "all") {
    result = result.filter((r) => r.status === filterStatus.value);
  }

  const field = sortField.value;
  const dir = sortDir.value === "asc" ? 1 : -1;
  result = [...result].sort((a, b) => {
    const va = a[field] ?? "";
    const vb = b[field] ?? "";
    if (typeof va === "number" && typeof vb === "number")
      return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  return result;
});

export function toggleSort(field) {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortField.value = field;
    sortDir.value = "desc";
  }
}

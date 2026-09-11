use tauri::command;

use crate::expand_tilde;
use crate::StdCommandNoWindow;

/// Reject paths containing traversal sequences like `..` to prevent escaping
/// intended directories. Returns the canonicalized path on success.
fn validate_no_traversal(path: &str) -> Result<String, String> {
    let expanded = expand_tilde(path);
    if expanded.is_empty() {
        return Err("Path is empty".to_string());
    }
    // Check for obvious traversal patterns before canonicalization
    if expanded.contains("..") {
        return Err("Path must not contain '..' traversal sequences".to_string());
    }
    Ok(expanded)
}

#[command]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    let expanded = validate_no_traversal(&path)?;
    std::fs::write(&expanded, contents).map_err(|e| e.to_string())
}

#[command]
pub fn get_cwd() -> String {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

#[command]
pub fn check_path_exists(path: String) -> Result<bool, String> {
    use std::path::PathBuf;
    let expanded = expand_tilde(&path);
    if expanded.is_empty() {
        return Ok(false);
    }
    Ok(PathBuf::from(&expanded).exists())
}

#[command]
pub fn ensure_project_dir(path: String) -> Result<String, String> {
    use std::fs;
    use std::path::PathBuf;

    let expanded = expand_tilde(&path);
    if expanded.is_empty() {
        return Err("Project path is empty".to_string());
    }
    let path_obj = PathBuf::from(&expanded);
    if path_obj.exists() {
        if path_obj.is_dir() {
            return Ok("Directory already exists".to_string());
        } else {
            return Err("Path exists but is not a directory".to_string());
        }
    }
    if let Ok(()) = fs::create_dir_all(&path_obj) {
        return Ok("Directory created".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "do shell script \"mkdir -p '{}'\" with administrator privileges",
            expanded.replace('\'', "'\\''")
        );
        let output = std::process::Command::new("osascript")
            .no_window()
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("Failed to request admin privileges: {}", e))?;
        if output.status.success() {
            return Ok("Directory created (elevated)".to_string());
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!(
                "Failed to create directory with admin privileges: {}",
                stderr
            ));
        }
    }

    #[cfg(target_os = "linux")]
    {
        let output = std::process::Command::new("pkexec")
            .no_window()
            .arg("mkdir")
            .arg("-p")
            .arg(&expanded)
            .output()
            .map_err(|e| format!("Failed to request admin privileges: {}", e))?;
        if output.status.success() {
            return Ok("Directory created (elevated)".to_string());
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!(
                "Failed to create directory with admin privileges: {}",
                stderr
            ));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("powershell")
            .no_window()
            .args([
                "-Command",
                &format!(
                    "New-Item -ItemType Directory -Force -Path '{}'",
                    expanded.replace('\'', "''")
                ),
            ])
            .output()
            .map_err(|e| format!("Failed to create directory: {}", e))?;
        if output.status.success() {
            return Ok("Directory created".to_string());
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("Failed to create directory: {}", stderr));
        }
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform for elevated directory creation".to_string())
}

#[derive(serde::Serialize)]
pub struct PathValidationResult {
    valid: bool,
    error: Option<String>,
}

#[command]
pub fn validate_folder_path(path: String) -> PathValidationResult {
    use std::path::Path;
    let expanded = expand_tilde(&path);
    let path_obj = Path::new(&expanded);
    if !path_obj.exists() {
        return PathValidationResult {
            valid: false,
            error: Some("Path does not exist".to_string()),
        };
    }
    if !path_obj.is_dir() {
        return PathValidationResult {
            valid: false,
            error: Some("Path is not a directory".to_string()),
        };
    }
    PathValidationResult {
        valid: true,
        error: None,
    }
}

#[command]
pub fn validate_file_path(path: String, expected_extension: Option<String>) -> PathValidationResult {
    use std::path::Path;
    let expanded = expand_tilde(&path);
    let path_obj = Path::new(&expanded);
    if !path_obj.exists() {
        return PathValidationResult {
            valid: false,
            error: Some("File does not exist".to_string()),
        };
    }
    if !path_obj.is_file() {
        return PathValidationResult {
            valid: false,
            error: Some("Path is not a file".to_string()),
        };
    }
    if let Some(ext) = expected_extension {
        if let Some(file_ext) = path_obj.extension() {
            if file_ext.to_string_lossy().to_lowercase() != ext.to_lowercase() {
                return PathValidationResult {
                    valid: false,
                    error: Some(format!("File must have .{} extension", ext)),
                };
            }
        } else {
            return PathValidationResult {
                valid: false,
                error: Some(format!("File must have .{} extension", ext)),
            };
        }
    }
    PathValidationResult {
        valid: true,
        error: None,
    }
}

const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "bmp", "webp", "tiff", "gif"];
const MASK_EXTS: &[&str] = &["png", "tiff", "bmp"];
const SPLIT_NAMES: &[&str] = &["train", "test", "val", "valid", "validation", "training", "testing"];

fn normalize_split_name(name: &str) -> &'static str {
    match name.to_lowercase().as_str() {
        "train" | "training" => "train",
        "val" | "valid" | "validation" => "val",
        "test" | "testing" => "test",
        _ => "train",
    }
}

#[command]
pub fn detect_dataset_splits(path: String) -> Result<Vec<String>, String> {
    let expanded = expand_tilde(&path);
    let resolved = std::path::PathBuf::from(&expanded);

    if !resolved.is_dir() {
        return Ok(vec![]);
    }

    let top_entries: Vec<_> = std::fs::read_dir(&resolved)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .collect();

    let is_split_based = top_entries.iter().any(|e| {
        let name = e.file_name().to_string_lossy().to_lowercase();
        SPLIT_NAMES.contains(&name.as_str())
    }) && top_entries.iter().all(|e| {
        let sub = match std::fs::read_dir(e.path()) {
            Ok(f) => f,
            Err(_) => return false,
        };
        sub.flatten().any(|se| se.path().is_dir())
    });

    if !is_split_based {
        return Ok(vec![]);
    }

    // Collect and normalize split names, preserving order: train, val, test
    let mut splits = Vec::new();
    let order = ["train", "val", "test"];
    let mut found: std::collections::HashSet<String> = std::collections::HashSet::new();
    for entry in &top_entries {
        let raw = entry.file_name().to_string_lossy().to_lowercase();
        if SPLIT_NAMES.contains(&raw.as_str()) {
            let normalized = normalize_split_name(&raw).to_string();
            if found.insert(normalized.clone()) {
                splits.push(normalized);
            }
        }
    }
    // Sort by canonical order
    splits.sort_by_key(|s| order.iter().position(|o| o == s).unwrap_or(99));
    Ok(splits)
}

#[derive(serde::Serialize)]
pub struct DatasetImage {
    pub path: String,
    pub label: String,
}

#[derive(serde::Serialize)]
pub struct DatasetBrowseResult {
    pub images: Vec<DatasetImage>,
    pub total: usize,
    pub class_counts: std::collections::HashMap<String, usize>,
}

fn csv_column_index(headers: &csv::StringRecord, name: Option<&str>, fallback: usize) -> Result<usize, String> {
    match name.map(str::trim).filter(|s| !s.is_empty()) {
        Some(name) => headers.iter().position(|h| h == name).ok_or_else(|| format!("CSV column '{name}' was not found. Check the column mapping.")),
        None => Ok(fallback),
    }
}

#[allow(clippy::too_many_arguments)]
#[command]
pub fn browse_dataset(
    path: String,
    format: String,
    limit: usize,
    offset: usize,
    class_filter: Option<Vec<String>>,
    image_folder: Option<String>,
    image_column: Option<String>,
    label_column: Option<String>,
    label_columns: Option<Vec<String>>,
    search: Option<String>,
    split: Option<String>,
) -> Result<DatasetBrowseResult, String> {
    let is_multilabel = label_columns.is_some();
    let expanded = expand_tilde(&path);
    let resolved_path = std::path::PathBuf::from(&expanded);

    if !resolved_path.exists() {
        return Err(format!("Path does not exist: {}", expanded));
    }

    let image_exts: &[&str] = IMAGE_EXTS;
    let mut all_images: Vec<DatasetImage> = Vec::new();
    let mut class_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    if format == "Folder" && resolved_path.is_dir() {
        // Collect image files from a class directory
        let mut collect_class = |class_dir: &std::path::Path, class_name: &str| {
            let files = match std::fs::read_dir(class_dir) {
                Ok(f) => f,
                Err(_) => return,
            };
            let mut count = 0usize;
            for file_entry in files.flatten() {
                let file_path = file_entry.path();
                if !file_path.is_file() { continue; }
                let ext = file_path.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if !image_exts.contains(&ext.as_str()) { continue; }

                count += 1;
                all_images.push(DatasetImage {
                    path: file_path.to_string_lossy().to_string(),
                    label: class_name.to_string(),
                });
            }
            *class_counts.entry(class_name.to_string()).or_insert(0) += count;
        };

        // Detect structure: check if top-level subdirs contain images directly
        // or contain further subdirs (split-based: train/test/val → class → images)
        let top_entries: Vec<_> = std::fs::read_dir(&resolved_path)
            .map_err(|e| e.to_string())?
            .flatten()
            .filter(|e| {
                let p = e.path();
                p.is_dir() && !e.file_name().to_string_lossy().starts_with('.')
            })
            .collect();

        // Peek into the first subdir to determine structure
        let is_split_based = top_entries.iter().any(|e| {
            let name = e.file_name().to_string_lossy().to_lowercase();
            matches!(name.as_str(), "train" | "test" | "val" | "valid" | "validation" | "training" | "testing")
        }) && top_entries.iter().all(|e| {
            // Check that subdirs contain further subdirs (not images directly)
            let sub_entries = match std::fs::read_dir(e.path()) {
                Ok(f) => f,
                Err(_) => return false,
            };
            sub_entries.flatten().any(|se| se.path().is_dir())
        });

        if is_split_based {
            // dataset/train/class_a/img.jpg structure
            // Filter to requested split if provided
            let filtered_entries: Vec<_> = if let Some(ref requested_split) = split {
                top_entries.into_iter().filter(|e| {
                    let raw = e.file_name().to_string_lossy().to_lowercase();
                    if SPLIT_NAMES.contains(&raw.as_str()) {
                        normalize_split_name(&raw) == requested_split.as_str()
                    } else {
                        false
                    }
                }).collect()
            } else {
                top_entries
            };
            for split_entry in filtered_entries {
                let split_path = split_entry.path();
                let class_entries = match std::fs::read_dir(&split_path) {
                    Ok(f) => f,
                    Err(_) => continue,
                };
                for class_entry in class_entries.flatten() {
                    let class_path = class_entry.path();
                    if !class_path.is_dir() { continue; }
                    let class_name = class_path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();
                    if class_name.starts_with('.') { continue; }
                    collect_class(&class_path, &class_name);
                }
            }
        } else {
            // dataset/class_a/img.jpg structure (flat ImageFolder)
            for entry in top_entries {
                let class_path = entry.path();
                let class_name = class_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                collect_class(&class_path, &class_name);
            }
        }
    } else if format == "CSV" && resolved_path.is_file() {
        // Parse CSV: first column = image path, second column = label
        // If image_folder is provided, prepend it to relative image paths
        let image_dir = image_folder
            .as_deref()
            .map(|f| std::path::PathBuf::from(expand_tilde(f)));

        let mut rdr = csv::Reader::from_path(&resolved_path)
            .map_err(|e| format!("Failed to read CSV: {}", e))?;

        let headers = rdr.headers()
            .map_err(|e| format!("Failed to read CSV headers: {}", e))?
            .clone();

        if headers.len() < 2 {
            return Err("CSV must have at least 2 columns (image path and label)".to_string());
        }

        // Find image and label columns by common names, fall back to positional
        let image_col_names = ["image_path", "image", "file", "filename", "filepath", "path", "img"];
        let label_col_names = ["label", "class", "category", "target", "class_name"];

        let image_default = headers.iter().position(|h| image_col_names.contains(&h.to_lowercase().as_str())).unwrap_or(0);
        let image_col_idx = csv_column_index(&headers, image_column.as_deref(), image_default)?;
        let label_default = headers.iter().position(|h| label_col_names.contains(&h.to_lowercase().as_str())).unwrap_or(if image_col_idx == 0 { 1 } else { 0 });
        let label_col_idx = if is_multilabel { label_default } else { csv_column_index(&headers, label_column.as_deref(), label_default)? };
        let multi_indices = if let Some(ref names) = label_columns {
            if names.is_empty() {
                (0..headers.len()).filter(|i| *i != image_col_idx).collect::<Vec<_>>()
            } else {
                names.iter().map(|name| csv_column_index(&headers, Some(name), 0)).collect::<Result<Vec<_>, _>>()?
            }
        } else { Vec::new() };
        for &index in &multi_indices { class_counts.insert(headers[index].to_string(), 0); }

        for result in rdr.records() {
            let record = result.map_err(|e| format!("CSV parse error: {}", e))?;
            let img_raw = record.get(image_col_idx).unwrap_or("").to_string();
            let active_labels: Vec<String> = if is_multilabel {
                multi_indices.iter().filter(|&&i| record.get(i).and_then(|v| v.trim().parse::<f64>().ok()).is_some_and(|v| v > 0.0))
                    .map(|&i| headers[i].to_string()).collect()
            } else { vec![record.get(label_col_idx).unwrap_or("unknown").to_string()] };
            let label = active_labels.join(" | ");

            if img_raw.is_empty() { continue; }

            let img_path_buf = std::path::PathBuf::from(&img_raw);
            let full_path = if img_path_buf.is_absolute() {
                img_path_buf
            } else if let Some(ref dir) = image_dir {
                dir.join(&img_raw)
            } else {
                // Relative to the CSV file's parent directory
                resolved_path.parent().unwrap_or(std::path::Path::new(".")).join(&img_raw)
            };

            // Only include if the file looks like an image
            let ext = full_path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !image_exts.contains(&ext.as_str()) { continue; }

            for name in active_labels { *class_counts.entry(name).or_insert(0) += 1; }
            all_images.push(DatasetImage {
                path: full_path.to_string_lossy().to_string(),
                label,
            });
        }
    } else if format == "JSONL" && resolved_path.is_file() {
        // Parse JSONL: each line is a JSON object with image and label fields
        // If image_folder is provided, prepend it to relative image paths
        let image_dir = image_folder
            .as_deref()
            .map(|f| std::path::PathBuf::from(expand_tilde(f)));

        let contents = std::fs::read_to_string(&resolved_path)
            .map_err(|e| format!("Failed to read JSONL file: {}", e))?;

        let image_keys = ["image_path", "image", "file", "filename", "filepath", "path", "img"];
        let label_keys = ["label", "class", "category", "target", "class_name"];

        for line in contents.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }

            let obj: serde_json::Value = serde_json::from_str(line)
                .map_err(|e| format!("JSONL parse error: {}", e))?;

            let obj_map = match obj.as_object() {
                Some(m) => m,
                None => continue,
            };

            // Find image path
            let img_raw = image_keys.iter()
                .find_map(|k| obj_map.get(*k).and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();

            // Find label
            let label = label_keys.iter()
                .find_map(|k| obj_map.get(*k).and_then(|v| v.as_str()))
                .unwrap_or("unknown")
                .to_string();

            if img_raw.is_empty() { continue; }

            let img_path_buf = std::path::PathBuf::from(&img_raw);
            let full_path = if img_path_buf.is_absolute() {
                img_path_buf
            } else if let Some(ref dir) = image_dir {
                dir.join(&img_raw)
            } else {
                // Relative to the JSONL file's parent directory
                resolved_path.parent().unwrap_or(std::path::Path::new(".")).join(&img_raw)
            };

            // Only include if the file looks like an image
            let ext = full_path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if !image_exts.contains(&ext.as_str()) { continue; }

            *class_counts.entry(label.clone()).or_insert(0) += 1;
            all_images.push(DatasetImage {
                path: full_path.to_string_lossy().to_string(),
                label,
            });
        }
    } else {
        return Err(format!("Unsupported format '{}' or invalid path", format));
    }

    // Sort by label then path for stable ordering
    all_images.sort_by(|a, b| a.label.cmp(&b.label).then(a.path.cmp(&b.path)));

    // Apply class filter if provided
    if let Some(ref filters) = class_filter
        && !filters.is_empty()
    {
        all_images.retain(|img| filters.contains(&img.label) || (is_multilabel && img.label.split(" | ").any(|label| filters.iter().any(|f| f == label))));
    }

    // Apply search filter if provided (matches filename or label, case-insensitive)
    if let Some(ref query) = search {
        let q = query.to_lowercase();
        if !q.is_empty() {
            all_images.retain(|img| {
                let filename = img.path.replace('\\', "/");
                let filename = filename.rsplit('/').next().unwrap_or("");
                filename.to_lowercase().contains(&q) || img.label.to_lowercase().contains(&q)
            });
        }
    }

    let total = all_images.len();

    // Apply pagination
    let paginated: Vec<DatasetImage> = all_images
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect();

    Ok(DatasetBrowseResult {
        images: paginated,
        total,
        class_counts,
    })
}

// ── Dataset structure validation ─────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct DatasetValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    /// Quick stats when valid
    pub info: std::collections::HashMap<String, String>,
}

/// Helper: count files with given extensions inside a dir (non-recursive).
fn count_files_with_exts(dir: &std::path::Path, exts: &[&str]) -> usize {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            let p = e.path();
            p.is_file()
                && p.extension()
                    .and_then(|x| x.to_str())
                    .map(|x| exts.contains(&x.to_lowercase().as_str()))
                    .unwrap_or(false)
        })
        .count()
}

/// Helper: list subdirectory names (non-hidden).
fn list_subdirs(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.')
        })
        .map(|e| e.file_name().to_string_lossy().to_string())
        .collect()
}

/// Helper: check if a dir has at least one file with the given extensions (recursive 1 level).
fn has_files_recursive(dir: &std::path::Path, exts: &[&str], depth: u8) -> bool {
    if count_files_with_exts(dir, exts) > 0 {
        return true;
    }
    if depth > 0 {
        for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            if entry.path().is_dir() && has_files_recursive(&entry.path(), exts, depth - 1) {
                return true;
            }
        }
    }
    false
}

#[command]
pub fn validate_dataset_structure(
    path: String,
    task_type: String,
    format: String,
) -> DatasetValidationResult {
    let expanded = expand_tilde(&path);
    let root = std::path::PathBuf::from(&expanded);

    let mut errors: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut info: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    // ── Basic checks ────────────────────────────────────────────────────────
    if !root.exists() {
        return DatasetValidationResult {
            valid: false,
            errors: vec!["Path does not exist.".into()],
            warnings: vec![],
            info,
        };
    }
    if !root.is_dir() {
        return DatasetValidationResult {
            valid: false,
            errors: vec!["Path is not a directory.".into()],
            warnings: vec![],
            info,
        };
    }

    let subdirs = list_subdirs(&root);
    if subdirs.is_empty() {
        errors.push("Directory is empty — no subdirectories or files found.".into());
        return DatasetValidationResult { valid: false, errors, warnings, info };
    }

    // ── Dispatch by task + format ───────────────────────────────────────────
    match (task_type.as_str(), format.as_str()) {
        ("Classification", "Folder") => {
            validate_classification_folder(&root, &subdirs, &mut errors, &mut warnings, &mut info);
        }
        ("Object Detection", "COCO JSON") | ("Instance Segmentation", "COCO JSON") => {
            validate_coco_json(&root, &subdirs, &task_type, &mut errors, &mut warnings, &mut info);
        }
        ("Semantic Segmentation", "PNG Masks") => {
            validate_seg_png_masks(&root, &subdirs, &mut errors, &mut warnings, &mut info);
        }
        ("Semantic Segmentation", "Cityscapes") => {
            validate_cityscapes(&root, &mut errors, &mut warnings, &mut info);
        }
        ("Semantic Segmentation", "VOC") => {
            validate_voc(&root, &mut errors, &mut warnings, &mut info);
        }
        ("Semantic Segmentation", "COCO") => {
            validate_coco_json(&root, &subdirs, &task_type, &mut errors, &mut warnings, &mut info);
        }
        _ => {
            // For CSV/JSONL formats the path field is a file, not a folder —
            // those are validated by validate_file_path instead.
            // Return valid with a note.
            info.insert("note".into(), "No structural validation available for this format.".into());
        }
    }

    DatasetValidationResult {
        valid: errors.is_empty(),
        errors,
        warnings,
        info,
    }
}

// ── Classification::Folder ──────────────────────────────────────────────────

fn validate_classification_folder(
    root: &std::path::Path,
    subdirs: &[String],
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
    info: &mut std::collections::HashMap<String, String>,
) {
    // Detect split-based vs flat
    let split_dirs: Vec<&String> = subdirs
        .iter()
        .filter(|d| SPLIT_NAMES.contains(&d.to_lowercase().as_str()))
        .collect();

    if !split_dirs.is_empty() {
        // ── Split-based: dataset/train/class_a/img.jpg ──
        info.insert("structure".into(), "split-based".into());
        info.insert("splits".into(), split_dirs.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", "));

        let has_train = split_dirs.iter().any(|d| {
            matches!(d.to_lowercase().as_str(), "train" | "training")
        });
        if !has_train {
            errors.push("No 'train' split directory found. Expected: train/, training/".into());
        }

        let mut total_classes = std::collections::HashSet::new();
        let mut total_images: usize = 0;

        for split_name in &split_dirs {
            let split_path = root.join(split_name);
            let class_dirs = list_subdirs(&split_path);

            if class_dirs.is_empty() {
                errors.push(format!(
                    "'{}/' has no class subdirectories. Expected: {}/class_a/, {}/class_b/, …",
                    split_name, split_name, split_name
                ));
                continue;
            }

            let mut empty_classes = Vec::new();
            for class_name in &class_dirs {
                let class_path = split_path.join(class_name);
                let img_count = count_files_with_exts(&class_path, IMAGE_EXTS);
                if img_count == 0 {
                    empty_classes.push(class_name.clone());
                }
                total_images += img_count;
                total_classes.insert(class_name.clone());
            }

            if !empty_classes.is_empty() && empty_classes.len() <= 5 {
                warnings.push(format!(
                    "'{}/' — class folders with no images: {}",
                    split_name,
                    empty_classes.join(", ")
                ));
            } else if !empty_classes.is_empty() {
                warnings.push(format!(
                    "'{}/' — {} class folders have no images.",
                    split_name,
                    empty_classes.len()
                ));
            }
        }

        if total_classes.len() < 2 {
            errors.push(format!(
                "Found only {} class(es). Classification requires at least 2 classes.",
                total_classes.len()
            ));
        }

        info.insert("classes".into(), total_classes.len().to_string());
        info.insert("images".into(), total_images.to_string());
    } else {
        // ── Flat: dataset/class_a/img.jpg ──
        info.insert("structure".into(), "flat".into());

        // Check if subdirs look like class folders (contain images)
        let mut class_count = 0usize;
        let mut total_images: usize = 0;
        let mut empty_classes = Vec::new();

        for dir_name in subdirs {
            let dir_path = root.join(dir_name);
            let img_count = count_files_with_exts(&dir_path, IMAGE_EXTS);
            if img_count > 0 {
                class_count += 1;
                total_images += img_count;
            } else {
                empty_classes.push(dir_name.clone());
            }
        }

        if class_count < 2 {
            errors.push(format!(
                "Found {} class folder(s) with images. Classification requires at least 2 class subdirectories, each containing images.",
                class_count
            ));
        }

        if !empty_classes.is_empty() && empty_classes.len() <= 5 {
            warnings.push(format!(
                "Subdirectories with no images (may not be class folders): {}",
                empty_classes.join(", ")
            ));
        }

        if total_images == 0 {
            errors.push("No image files found in any subdirectory.".into());
        }

        warnings.push(
            "No train/val split detected. Consider splitting into train/ and val/ subdirectories for proper evaluation.".into()
        );

        info.insert("classes".into(), class_count.to_string());
        info.insert("images".into(), total_images.to_string());
    }
}

// ── COCO JSON (Detection / Instance Segmentation / COCO Segmentation) ───────

fn validate_coco_json(
    root: &std::path::Path,
    subdirs: &[String],
    task_type: &str,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
    info: &mut std::collections::HashMap<String, String>,
) {
    // Expect an annotations/ dir
    let ann_dir = root.join("annotations");
    if !ann_dir.is_dir() {
        errors.push("Missing 'annotations/' directory. Expected: annotations/instances_train.json".into());
    } else {
        // Look for JSON files inside annotations/
        let json_files: Vec<String> = std::fs::read_dir(&ann_dir)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| {
                e.path().is_file()
                    && e.path()
                        .extension()
                        .and_then(|x| x.to_str())
                        .map(|x| x.to_lowercase() == "json")
                        .unwrap_or(false)
            })
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        if json_files.is_empty() {
            errors.push("'annotations/' directory has no JSON files.".into());
        } else {
            info.insert("annotation_files".into(), json_files.join(", "));

            // Check for train annotations
            let has_train_ann = json_files.iter().any(|f| {
                let lower = f.to_lowercase();
                lower.contains("train")
            });
            if !has_train_ann {
                warnings.push("No training annotation file found (expected a file containing 'train' in its name).".into());
            }

            // Optionally validate JSON structure of the first file
            if let Some(first) = json_files.first() {
                let ann_path = ann_dir.join(first);
                match std::fs::read_to_string(&ann_path) {
                    Ok(contents) => {
                        match serde_json::from_str::<serde_json::Value>(&contents) {
                            Ok(val) => {
                                let obj = val.as_object();
                                if let Some(obj) = obj {
                                    let has_images = obj.contains_key("images");
                                    let has_annotations = obj.contains_key("annotations");
                                    let has_categories = obj.contains_key("categories");

                                    if !has_images {
                                        errors.push(format!("'{}' is missing 'images' key.", first));
                                    }
                                    if !has_annotations {
                                        errors.push(format!("'{}' is missing 'annotations' key.", first));
                                    }
                                    if !has_categories {
                                        errors.push(format!("'{}' is missing 'categories' key.", first));
                                    }

                                    if has_images
                                        && let Some(imgs) = obj["images"].as_array()
                                    {
                                        info.insert("images_in_annotation".into(), imgs.len().to_string());
                                    }
                                    if has_categories
                                        && let Some(cats) = obj["categories"].as_array()
                                    {
                                        info.insert("categories".into(), cats.len().to_string());
                                    }

                                    // Instance seg needs 'segmentation' in annotations
                                    if task_type == "Instance Segmentation"
                                        && has_annotations
                                        && let Some(anns) = obj["annotations"].as_array()
                                        && let Some(first_ann) = anns.first()
                                        && first_ann.get("segmentation").is_none()
                                    {
                                        warnings.push("Annotations may lack 'segmentation' field needed for instance segmentation.".into());
                                    }
                                } else {
                                    errors.push(format!("'{}' is not a JSON object at the top level.", first));
                                }
                            }
                            Err(e) => {
                                errors.push(format!("'{}' is not valid JSON: {}", first, e));
                            }
                        }
                    }
                    Err(e) => {
                        warnings.push(format!("Could not read '{}': {}", first, e));
                    }
                }
            }
        }
    }

    // Check for image directories
    let image_dirs: Vec<&String> = subdirs
        .iter()
        .filter(|d| {
            let lower = d.to_lowercase();
            lower != "annotations"
                && !lower.starts_with('.')
        })
        .collect();

    let has_image_dir_with_images = image_dirs.iter().any(|d| {
        has_files_recursive(&root.join(d), IMAGE_EXTS, 1)
    });

    if !has_image_dir_with_images {
        errors.push("No image directories found alongside annotations/. Expected: train/, val/ or images/ containing image files.".into());
    } else {
        let dir_names: Vec<&str> = image_dirs.iter().map(|s| s.as_str()).collect();
        info.insert("image_dirs".into(), dir_names.join(", "));
    }
}

// ── Semantic Segmentation::PNG Masks ────────────────────────────────────────

fn validate_seg_png_masks(
    root: &std::path::Path,
    subdirs: &[String],
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
    info: &mut std::collections::HashMap<String, String>,
) {
    let lower_dirs: Vec<String> = subdirs.iter().map(|s| s.to_lowercase()).collect();

    // Expect images/ and masks/ directories
    let has_images = lower_dirs.iter().any(|d| d == "images" || d == "image" || d == "imgs" || d == "img");
    let has_masks = lower_dirs.iter().any(|d| d == "masks" || d == "mask" || d == "labels" || d == "annotations");

    if !has_images {
        errors.push("Missing 'images/' directory. Expected parallel 'images/' and 'masks/' directories.".into());
    }
    if !has_masks {
        errors.push("Missing 'masks/' directory. Expected parallel 'images/' and 'masks/' directories.".into());
    }

    if has_images && has_masks {
        // Find actual dir names (case-preserving)
        let images_dir_name = subdirs.iter().find(|s| {
            let l = s.to_lowercase();
            l == "images" || l == "image" || l == "imgs" || l == "img"
        }).unwrap();
        let masks_dir_name = subdirs.iter().find(|s| {
            let l = s.to_lowercase();
            l == "masks" || l == "mask" || l == "labels" || l == "annotations"
        }).unwrap();

        let images_path = root.join(images_dir_name);
        let masks_path = root.join(masks_dir_name);

        // Check for splits or direct files
        let img_subdirs = list_subdirs(&images_path);
        let mask_subdirs = list_subdirs(&masks_path);

        let img_has_splits = img_subdirs.iter().any(|d| SPLIT_NAMES.contains(&d.to_lowercase().as_str()));
        let mask_has_splits = mask_subdirs.iter().any(|d| SPLIT_NAMES.contains(&d.to_lowercase().as_str()));

        if img_has_splits && !mask_has_splits {
            errors.push(format!(
                "'{}/' has split directories (train/val) but '{}/' does not. Both must use the same structure.",
                images_dir_name, masks_dir_name
            ));
        } else if !img_has_splits && mask_has_splits {
            errors.push(format!(
                "'{}/' has split directories but '{}/' does not. Both must use the same structure.",
                masks_dir_name, images_dir_name
            ));
        }

        if img_has_splits && mask_has_splits {
            info.insert("structure".into(), "split-based".into());
            // Validate each split
            for split in &img_subdirs {
                if !SPLIT_NAMES.contains(&split.to_lowercase().as_str()) { continue; }
                let img_split = images_path.join(split);
                let mask_split = masks_path.join(split);

                if !mask_split.is_dir() {
                    errors.push(format!("'{}/{}/' exists but '{}/{}/' is missing.", images_dir_name, split, masks_dir_name, split));
                    continue;
                }

                let img_count = count_files_with_exts(&img_split, IMAGE_EXTS);
                let mask_count = count_files_with_exts(&mask_split, MASK_EXTS);

                info.insert(format!("{}_images", split), img_count.to_string());
                info.insert(format!("{}_masks", split), mask_count.to_string());

                if img_count == 0 {
                    warnings.push(format!("'{}/{}/' has no image files.", images_dir_name, split));
                }
                if mask_count == 0 {
                    warnings.push(format!("'{}/{}/' has no mask files.", masks_dir_name, split));
                }
                if img_count > 0 && mask_count > 0 && img_count != mask_count {
                    warnings.push(format!(
                        "Split '{}': {} images vs {} masks — counts don't match. Ensure filenames correspond.",
                        split, img_count, mask_count
                    ));
                }
            }
        } else {
            info.insert("structure".into(), "flat".into());
            let img_count = count_files_with_exts(&images_path, IMAGE_EXTS);
            let mask_count = count_files_with_exts(&masks_path, MASK_EXTS);

            info.insert("images".into(), img_count.to_string());
            info.insert("masks".into(), mask_count.to_string());

            if img_count == 0 {
                errors.push(format!("'{}/' has no image files.", images_dir_name));
            }
            if mask_count == 0 {
                errors.push(format!("'{}/' has no mask files.", masks_dir_name));
            }
            if img_count > 0 && mask_count > 0 && img_count != mask_count {
                warnings.push(format!(
                    "{} images vs {} masks — counts don't match. Ensure filenames correspond.",
                    img_count, mask_count
                ));
            }
        }
    }
}

// ── Semantic Segmentation::Cityscapes ───────────────────────────────────────

fn validate_cityscapes(
    root: &std::path::Path,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
    info: &mut std::collections::HashMap<String, String>,
) {
    let left_img = root.join("leftImg8bit");
    let gt_fine = root.join("gtFine");

    if !left_img.is_dir() {
        errors.push("Missing 'leftImg8bit/' directory. Expected standard Cityscapes layout.".into());
    }
    if !gt_fine.is_dir() {
        errors.push("Missing 'gtFine/' directory. Expected standard Cityscapes layout.".into());
    }

    if left_img.is_dir() && gt_fine.is_dir() {
        let img_splits = list_subdirs(&left_img);
        let gt_splits = list_subdirs(&gt_fine);

        let has_train = img_splits.iter().any(|s| s.to_lowercase() == "train");
        if !has_train {
            errors.push("'leftImg8bit/' has no 'train/' split directory.".into());
        }

        // Check that gt splits match img splits
        for split in &img_splits {
            if !gt_splits.iter().any(|g| g.to_lowercase() == split.to_lowercase()) {
                warnings.push(format!(
                    "'leftImg8bit/{}/' exists but 'gtFine/{}/' is missing.",
                    split, split
                ));
            }
        }

        info.insert("img_splits".into(), img_splits.join(", "));
        info.insert("gt_splits".into(), gt_splits.join(", "));
    }
}

// ── Semantic Segmentation::VOC ──────────────────────────────────────────────

fn validate_voc(
    root: &std::path::Path,
    errors: &mut Vec<String>,
    warnings: &mut Vec<String>,
    info: &mut std::collections::HashMap<String, String>,
) {
    // VOC can be at root or inside VOCdevkit/VOC20xx/
    let voc_root = if root.join("JPEGImages").is_dir() {
        root.to_path_buf()
    } else {
        // Search one or two levels for VOC20xx
        let mut found = None;
        for entry in std::fs::read_dir(root).into_iter().flatten().flatten() {
            let p = entry.path();
            if p.is_dir() {
                if p.join("JPEGImages").is_dir() {
                    found = Some(p);
                    break;
                }
                // Check one more level (VOCdevkit/VOC2012/)
                for sub in std::fs::read_dir(&p).into_iter().flatten().flatten() {
                    if sub.path().is_dir() && sub.path().join("JPEGImages").is_dir() {
                        found = Some(sub.path());
                        break;
                    }
                }
                if found.is_some() { break; }
            }
        }
        found.unwrap_or_else(|| root.to_path_buf())
    };

    let jpeg_dir = voc_root.join("JPEGImages");
    let seg_class_dir = voc_root.join("SegmentationClass");
    let image_sets_dir = voc_root.join("ImageSets").join("Segmentation");

    if !jpeg_dir.is_dir() {
        errors.push("Missing 'JPEGImages/' directory. Expected Pascal VOC layout.".into());
    } else {
        let count = count_files_with_exts(&jpeg_dir, IMAGE_EXTS);
        info.insert("images".into(), count.to_string());
        if count == 0 {
            errors.push("'JPEGImages/' has no image files.".into());
        }
    }

    if !seg_class_dir.is_dir() {
        errors.push("Missing 'SegmentationClass/' directory for segmentation masks.".into());
    } else {
        let count = count_files_with_exts(&seg_class_dir, MASK_EXTS);
        info.insert("masks".into(), count.to_string());
        if count == 0 {
            errors.push("'SegmentationClass/' has no mask files.".into());
        }
    }

    if !image_sets_dir.is_dir() {
        warnings.push("Missing 'ImageSets/Segmentation/' directory with train.txt / val.txt split files.".into());
    } else {
        let has_train_txt = image_sets_dir.join("train.txt").is_file();
        let has_val_txt = image_sets_dir.join("val.txt").is_file();
        if !has_train_txt {
            warnings.push("Missing 'ImageSets/Segmentation/train.txt'.".into());
        }
        if !has_val_txt {
            warnings.push("Missing 'ImageSets/Segmentation/val.txt'.".into());
        }
    }

    if voc_root != root {
        info.insert("voc_root".into(), voc_root.to_string_lossy().to_string());
    }
}

#[cfg(test)]
mod csv_mapping_tests {
    use super::*;
    #[test]
    fn resolves_exact_headers_and_rejects_missing_names() {
        let headers = csv::StringRecord::from(vec!["id", "diagnosis", "scan_file"]);
        assert_eq!(csv_column_index(&headers, Some("scan_file"), 0).unwrap(), 2);
        assert_eq!(csv_column_index(&headers, Some("diagnosis"), 0).unwrap(), 1);
        assert_eq!(csv_column_index(&headers, None, 0).unwrap(), 0);
        assert!(csv_column_index(&headers, Some("Scan_File"), 0).is_err());
    }
    #[test]
    fn multilabel_preview_counts_and_filters_selected_headers() {
        let path = std::env::temp_dir().join(format!("nightflow-multilabel-{}.csv", std::process::id()));
        std::fs::write(&path, "scan,cat,dog,bird\na.png,1,0,0\nb.png,1,1,0\n").unwrap();
        let result = browse_dataset(path.to_string_lossy().into(), "CSV".into(), 10, 0, Some(vec!["dog".into()]), None,
            Some("scan".into()), None, Some(vec!["cat".into(), "dog".into(), "bird".into()]), None, None).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.class_counts["cat"], 2);
        assert_eq!(result.class_counts["bird"], 0);
        assert!(result.images[0].path.ends_with("b.png"));
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn preview_uses_custom_columns() {
        let path = std::env::temp_dir().join(format!("nightflow-columns-{}.csv", std::process::id()));
        std::fs::write(&path, "id,diagnosis,scan_file\n42,normal,scan.png\n").unwrap();
        let result = browse_dataset(path.to_string_lossy().into(), "CSV".into(), 10, 0, None, None,
            Some("scan_file".into()), Some("diagnosis".into()), None, None, None).unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.images[0].label, "normal");
        assert!(result.images[0].path.ends_with("scan.png"));
        std::fs::remove_file(path).unwrap();
    }
}

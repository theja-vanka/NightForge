use std::collections::HashMap;
use tauri::command;

use crate::expand_tilde;
use crate::TokioCommandNoWindow;

#[command]
pub fn list_run_folders(project_path: String) -> Result<Vec<String>, String> {
    let expanded = expand_tilde(&project_path);
    let logs_dir = std::path::PathBuf::from(&expanded).join("logs");

    if !logs_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(&logs_dir).map_err(|e| {
        format!(
            "Failed to read logs directory {}: {}",
            logs_dir.display(),
            e
        )
    })?;

    let mut names = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir()
            && let Some(run_id) = path.file_name().and_then(|s| s.to_str())
        {
            names.push(run_id.to_string());
        }
    }
    names.sort();
    Ok(names)
}

#[command]
pub fn parse_run_jsonl(
    project_path: String,
    run_id: String,
) -> Result<HashMap<String, Vec<serde_json::Value>>, String> {
    let expanded = expand_tilde(&project_path);
    let file_path = std::path::PathBuf::from(&expanded)
        .join("logs")
        .join(&run_id)
        .join(format!("{}.jsonl", run_id));

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {}", file_path.display(), e))?;

    let mut scalars: HashMap<String, Vec<serde_json::Value>> = HashMap::new();

    for line in content.lines() {
        let json: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event = json.get("event").and_then(|v| v.as_str()).unwrap_or("");
        if event != "epoch_end" && event != "validation_end" && event != "testing_complete" {
            continue;
        }

        let epoch = json.get("epoch").and_then(|v| v.as_i64()).unwrap_or(0);
        let metrics = match json.get("metrics").and_then(|v| v.as_object()) {
            Some(m) => m,
            None => continue,
        };

        for (tag, val) in metrics {
            if let Some(num) = val.as_f64() {
                let entry = scalars.entry(tag.clone()).or_default();
                entry.push(serde_json::json!({ "epoch": epoch, "value": num }));
            }
        }
    }

    for points in scalars.values_mut() {
        points.sort_by(|a, b| {
            let sa = a.get("epoch").and_then(|v| v.as_i64()).unwrap_or(0);
            let sb = b.get("epoch").and_then(|v| v.as_i64()).unwrap_or(0);
            sa.cmp(&sb)
        });
    }

    Ok(scalars)
}

#[command]
pub fn parse_csv_run(
    project_path: String,
    run_id: String,
) -> Result<HashMap<String, Vec<serde_json::Value>>, String> {
    let expanded = expand_tilde(&project_path);
    let mut file_path = std::path::PathBuf::from(&expanded)
        .join("logs")
        .join(&run_id)
        .join("metrics.csv");

    if !file_path.exists() {
        let alt_path = std::path::PathBuf::from(&expanded)
            .join("logs")
            .join(&run_id)
            .join("version_0")
            .join("metrics.csv");
        if alt_path.exists() {
            file_path = alt_path;
        } else {
            return Err(format!("metrics.csv not found for run {}", run_id));
        }
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read {}: {}", file_path.display(), e))?;

    let mut scalars: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    let mut lines = content.lines();

    if let Some(header_line) = lines.next() {
        let headers: Vec<&str> = header_line.split(',').collect();
        let epoch_idx = headers.iter().position(|&h| h == "epoch");
        let step_idx = headers.iter().position(|&h| h == "step").unwrap_or(0);

        for line in lines {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.is_empty() {
                continue;
            }

            // Prefer epoch column, fall back to step
            let epoch: i64 = epoch_idx
                .and_then(|idx| parts.get(idx).and_then(|s| s.parse().ok()))
                .unwrap_or_else(|| parts.get(step_idx).and_then(|s| s.parse().ok()).unwrap_or(0));

            for (i, &val_str) in parts.iter().enumerate() {
                if Some(i) == epoch_idx || i == step_idx { continue; }
                if let Some(header) = headers.get(i) {
                    if val_str.is_empty() { continue; }

                    if let Ok(num) = val_str.parse::<f64>() {
                        let entry = scalars.entry(header.to_string()).or_default();
                        entry.push(serde_json::json!({ "epoch": epoch, "value": num }));
                    }
                }
            }
        }
    }

    for points in scalars.values_mut() {
        points.sort_by(|a, b| {
            let sa = a.get("epoch").and_then(|v| v.as_i64()).unwrap_or(0);
            let sb = b.get("epoch").and_then(|v| v.as_i64()).unwrap_or(0);
            sa.cmp(&sb)
        });
    }

    Ok(scalars)
}

#[command]
pub fn parse_hparams_yaml(
    project_path: String,
    run_id: String,
) -> Result<HashMap<String, serde_json::Value>, String> {
    let expanded = expand_tilde(&project_path);
    let base = std::path::PathBuf::from(&expanded).join("logs").join(&run_id);

    // Try direct path first, then version_0 subdirectory
    let candidates = [
        base.join("hparams.yaml"),
        base.join("version_0").join("hparams.yaml"),
    ];

    let file_path = candidates
        .iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!("hparams.yaml not found for run {}", run_id))?;

    let content = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read {}: {}", file_path.display(), e))?;

    let yaml_value: serde_yaml::Value = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse YAML: {}", e))?;

    // Convert YAML mapping to HashMap<String, serde_json::Value>
    let mut result: HashMap<String, serde_json::Value> = HashMap::new();
    if let serde_yaml::Value::Mapping(map) = yaml_value {
        for (k, v) in map {
            if let serde_yaml::Value::String(key) = k {
                result.insert(key, yaml_to_json(v));
            }
        }
    }

    Ok(result)
}

/// Check which runs have a checkpoint file in `logs/{run_id}/checkpoints/`.
/// Returns only the run IDs that have at least one `.ckpt` file.
/// Supports both local filesystem and remote projects via SSH.
#[command]
pub async fn check_runs_checkpoints(
    project_path: String,
    run_ids: Vec<String>,
    ssh_command: Option<String>,
) -> Result<Vec<String>, String> {
    let expanded = expand_tilde(&project_path);

    if let Some(ssh_cmd) = ssh_command {
        // Remote: check via SSH
        let parts: Vec<String> = ssh_cmd.split_whitespace().map(String::from).collect();
        if parts.len() < 2 {
            return Err("Invalid SSH command".to_string());
        }

        // Build a single script that checks all run IDs at once
        let checks: Vec<String> = run_ids
            .iter()
            .map(|rid| {
                let dir = format!("{}/logs/{}/checkpoints", expanded, rid);
                format!(r#"if ls "{dir}"/*.ckpt 1>/dev/null 2>&1; then echo "{rid}"; fi"#)
            })
            .collect();
        let script = checks.join("\n");

        let output = tokio::process::Command::new(&parts[0])
            .no_window()
            .args(&parts[1..])
            .arg(&script)
            .output()
            .await
            .map_err(|e| format!("SSH failed: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let result: Vec<String> = stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

        Ok(result)
    } else {
        // Local: check filesystem directly
        let base = std::path::PathBuf::from(&expanded).join("logs");
        let mut result = Vec::new();

        for run_id in &run_ids {
            let ckpt_dir = base.join(run_id).join("checkpoints");
            if ckpt_dir.is_dir()
                && let Ok(entries) = std::fs::read_dir(&ckpt_dir)
            {
                let has_ckpt = entries
                    .flatten()
                    .any(|e| {
                        e.path()
                            .extension()
                            .map(|ext| ext == "ckpt")
                            .unwrap_or(false)
                    });
                if has_ckpt {
                    result.push(run_id.clone());
                }
            }
        }

        Ok(result)
    }
}

fn yaml_to_json(v: serde_yaml::Value) -> serde_json::Value {
    match v {
        serde_yaml::Value::Null => serde_json::Value::Null,
        serde_yaml::Value::Bool(b) => serde_json::Value::Bool(b),
        serde_yaml::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                serde_json::Value::Number(i.into())
            } else if let Some(f) = n.as_f64() {
                serde_json::json!(f)
            } else {
                serde_json::Value::Null
            }
        }
        serde_yaml::Value::String(s) => serde_json::Value::String(s),
        serde_yaml::Value::Sequence(seq) => {
            serde_json::Value::Array(seq.into_iter().map(yaml_to_json).collect())
        }
        serde_yaml::Value::Mapping(map) => {
            let obj: serde_json::Map<String, serde_json::Value> = map
                .into_iter()
                .filter_map(|(k, v)| {
                    if let serde_yaml::Value::String(key) = k {
                        Some((key, yaml_to_json(v)))
                    } else {
                        None
                    }
                })
                .collect();
            serde_json::Value::Object(obj)
        }
        serde_yaml::Value::Tagged(tagged) => yaml_to_json(tagged.value),
    }
}

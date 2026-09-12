use std::path::PathBuf;
use tauri::command;

use crate::expand_tilde;
use crate::TokioCommandNoWindow;

/// Write a base64-encoded image to the interpretation directory for a run.
/// Returns the written file path.
#[command]
pub async fn save_interpretation_image(
    project_path: String,
    run_id: String,
    image_base64: String,
) -> Result<String, String> {
    let pp = expand_tilde(project_path.trim_end_matches('/').trim_end_matches('\\'));
    let dir = PathBuf::from(&pp)
        .join("logs")
        .join(&run_id)
        .join("interpretations");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create interpretations dir: {e}"))?;

    let file_path = dir.join("input.png");

    // Strip data URL prefix if present (e.g. "data:image/png;base64,")
    let raw = if let Some(idx) = image_base64.find(",") {
        &image_base64[idx + 1..]
    } else {
        &image_base64
    };

    use std::io::Write;
    let bytes = base64_decode(raw)?;
    let mut f = std::fs::File::create(&file_path)
        .map_err(|e| format!("Failed to create image file: {e}"))?;
    f.write_all(&bytes)
        .map_err(|e| format!("Failed to write image: {e}"))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// Minimal base64 decoder (RFC 4648, no padding required).
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Strip whitespace
    let clean: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    let mut bytes = Vec::with_capacity(clean.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;

    for ch in clean.chars() {
        let val = match ch {
            'A'..='Z' => (ch as u32) - ('A' as u32),
            'a'..='z' => (ch as u32) - ('a' as u32) + 26,
            '0'..='9' => (ch as u32) - ('0' as u32) + 52,
            '+' => 62,
            '/' => 63,
            '=' => continue,
            _ => return Err(format!("Invalid base64 character: {ch}")),
        };
        buf = (buf << 6) | val;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    Ok(bytes)
}

/// Run interpretation on a trained model checkpoint.
///
/// Locates the checkpoint in `logs/{run_id}/checkpoints/`, runs interpret_cli,
/// and returns the JSON result with heatmap paths.
#[command]
pub async fn run_interpretation(
    project_path: String,
    run_id: String,
    image_path: String,
    methods: Vec<String>,
    task_class: Option<String>,
    ssh_command: Option<String>,
) -> Result<serde_json::Value, String> {
    let pp = expand_tilde(project_path.trim_end_matches('/').trim_end_matches('\\'));
    let pp_path = PathBuf::from(&pp);
    let ckpt_dir = pp_path.join("logs").join(&run_id).join("checkpoints");
    let output_dir = pp_path.join("logs").join(&run_id).join("interpretations");
    let ckpt_dir_str = ckpt_dir.to_string_lossy().to_string();
    let output_dir_str = output_dir.to_string_lossy().to_string();
    let methods_str = methods.join(",");
    let tc = task_class.unwrap_or_else(|| "ImageClassifier".to_string());

    // Locate hparams.yaml (try direct path first, then version_0 subdirectory)
    let hparams_base = pp_path.join("logs").join(&run_id);
    let hparams_candidates = [
        hparams_base.join("hparams.yaml"),
        hparams_base.join("version_0").join("hparams.yaml"),
    ];
    let hparams_path = hparams_candidates.iter().find(|p| p.exists());

    if let Some(ssh_cmd) = ssh_command {
        // ── Remote execution via SSH ────────────────────────────────────
        let parts: Vec<String> = ssh_cmd.split_whitespace().map(String::from).collect();
        if parts.len() < 2 {
            return Err("Invalid SSH command".to_string());
        }

        // Find checkpoint remotely
        let find_script = format!(
            r#"find "{ckpt_dir_str}" -name "*.ckpt" -type f 2>/dev/null | head -1"#
        );
        let find_output = tokio::process::Command::new(&parts[0])
            .no_window()
            .args(&parts[1..])
            .arg(&find_script)
            .output()
            .await
            .map_err(|e| format!("SSH failed: {e}"))?;

        let remote_ckpt = String::from_utf8_lossy(&find_output.stdout)
            .trim()
            .to_string();
        if remote_ckpt.is_empty() {
            return Err(
                "No checkpoint found. Training may not have saved a model yet.".to_string(),
            );
        }

        // Resolve python (prefer venv)
        let venv_python = format!("{pp}/.venv/bin/python");
        let python_cmd = format!(
            "if [ -x \"{venv_python}\" ]; then echo \"{venv_python}\"; else echo python3; fi"
        );
        let py_output = tokio::process::Command::new(&parts[0])
            .no_window()
            .args(&parts[1..])
            .arg(&python_cmd)
            .output()
            .await
            .map_err(|e| format!("SSH python check failed: {e}"))?;
        let python = String::from_utf8_lossy(&py_output.stdout)
            .trim()
            .to_string();

        // Run interpretation remotely
        let hparams_arg = hparams_base.join("hparams.yaml");
        let hparams_arg_str = hparams_arg.to_string_lossy();
        let run_cmd = format!(
            "{python} -m autotimm.cli.interpret_cli --checkpoint \"{remote_ckpt}\" --image \"{image_path}\" --methods \"{methods_str}\" --output-dir \"{output_dir_str}\" --task-class \"{tc}\" --hparams-yaml \"{hparams_arg_str}\""
        );

        let output = tokio::process::Command::new(&parts[0])
            .no_window()
            .args(&parts[1..])
            .arg(&run_cmd)
            .output()
            .await
            .map_err(|e| format!("SSH interpretation failed: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            // Try to extract a meaningful error from JSON output
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout)
                && let Some(error) = val.get("error").and_then(|e| e.as_str())
            {
                return Err(error.to_string());
            }
            return Err(format!("Interpretation failed: {stderr}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        // SCP results back to local temp
        let local_output = std::env::temp_dir()
            .join("nightflow_interp")
            .join(&run_id);
        let _ = std::fs::create_dir_all(&local_output);

        // Parse SSH command to build SCP args
        let mut scp_args: Vec<String> = Vec::new();
        let mut host_part = String::new();
        let mut i = 1;
        while i < parts.len() {
            if parts[i] == "-p" || parts[i] == "-i" || parts[i] == "-o" {
                scp_args.push(if parts[i] == "-p" {
                    "-P".to_string()
                } else {
                    parts[i].clone()
                });
                if i + 1 < parts.len() {
                    scp_args.push(parts[i + 1].clone());
                    i += 2;
                } else {
                    i += 1;
                }
            } else {
                host_part = parts[i].clone();
                i += 1;
            }
        }

        // SCP the output directory
        let scp_source = format!("{host_part}:{output_dir_str}/*");
        scp_args.push("-r".to_string());
        scp_args.push(scp_source);
        scp_args.push(local_output.to_string_lossy().to_string());

        let scp_result = tokio::process::Command::new("scp")
            .no_window()
            .args(&scp_args)
            .output()
            .await
            .map_err(|e| format!("SCP failed: {e}"))?;

        if !scp_result.status.success() {
            let stderr = String::from_utf8_lossy(&scp_result.stderr);
            return Err(format!("SCP download failed: {stderr}"));
        }

        // Rewrite paths in the JSON to point to local copies
        let mut result: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("Invalid JSON output: {e}"))?;

        if let Some(results) = result.get_mut("results").and_then(|r| r.as_object_mut()) {
            for (_method, path_val) in results.iter_mut() {
                if let Some(remote_path) = path_val.as_str() {
                    let filename = std::path::Path::new(remote_path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    let local_path = local_output.join(&filename);
                    *path_val = serde_json::Value::String(local_path.to_string_lossy().to_string());
                }
            }
        }

        Ok(result)
    } else {
        // ── Local execution ─────────────────────────────────────────────
        let mut best_ckpt: Option<PathBuf> = None;

        if let Ok(entries) = std::fs::read_dir(&ckpt_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str())
                    && name.ends_with(".ckpt")
                {
                    best_ckpt = Some(path);
                }
            }
        }

        let ckpt = best_ckpt
            .ok_or("No checkpoint found. Training may not have saved a model yet.")?;

        // Resolve python: prefer project venv, then system python
        let venv_python = crate::env::venv_python(&PathBuf::from(&pp).join(".venv"));
        let python = if venv_python.exists() {
            venv_python.to_string_lossy().to_string()
        } else {
            crate::env::python_cmd().to_string()
        };

        let output = tokio::process::Command::new(&python)
            .no_window()
            .arg("-m")
            .arg("autotimm.cli.interpret_cli")
            .arg("--checkpoint")
            .arg(ckpt.to_string_lossy().to_string())
            .arg("--image")
            .arg(&image_path)
            .arg("--methods")
            .arg(&methods_str)
            .arg("--output-dir")
            .arg(output_dir.to_string_lossy().to_string())
            .arg("--task-class")
            .arg(&tc)
            .args(if let Some(hp) = &hparams_path {
                vec!["--hparams-yaml".to_string(), hp.to_string_lossy().to_string()]
            } else {
                vec![]
            })
            .current_dir(&pp)
            .output()
            .await
            .map_err(|e| format!("Failed to run interpretation: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Try to extract a meaningful error from JSON output
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout) {
                if let Some(error) = val.get("error").and_then(|e| e.as_str()) {
                    return Err(error.to_string());
                }
                // Partial results without top-level error — return them
                return Ok(val);
            }
            return Err(format!("Interpretation failed: {stderr}"));
        }

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let result: serde_json::Value =
            serde_json::from_str(&stdout).map_err(|e| format!("Invalid JSON output: {e}"))?;

        Ok(result)
    }
}

/// Preview augmentation transforms on an image.
/// Runs a small Python script that applies augmentation preset transforms
/// and returns base64-encoded augmented images.
///
/// The image arrives as base64 because the UI sources it from a file picker,
/// which yields bytes rather than a path the backend could open. It is written
/// to a temp file for the Python script and removed again before returning.
#[command]
pub async fn preview_augmentation(
    project_path: String,
    image_base64: String,
    preset: String,
    ssh_command: Option<String>,
) -> Result<Vec<String>, String> {
    // The preview always runs against the local project venv; there is no
    // remote path here, so say so rather than silently previewing the wrong env.
    if ssh_command.is_some() {
        return Err(
            "Augmentation preview runs locally and is not available for remote projects."
                .to_string(),
        );
    }

    let pp = expand_tilde(project_path.trim_end_matches('/').trim_end_matches('\\'));

    // Strip data URL prefix if present (e.g. "data:image/png;base64,")
    let raw = match image_base64.find(',') {
        Some(idx) => &image_base64[idx + 1..],
        None => &image_base64,
    };
    let bytes = base64_decode(raw)?;

    let tmp_path = std::env::temp_dir().join(format!(
        "nightflow-aug-preview-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Failed to stage preview image: {e}"))?;
    let image_path = tmp_path.to_string_lossy().to_string();

    // Resolve python: prefer project venv
    let venv_python = crate::env::venv_python(&PathBuf::from(&pp).join(".venv"));
    let python = if venv_python.exists() {
        venv_python.to_string_lossy().to_string()
    } else {
        crate::env::python_cmd().to_string()
    };

    let output = tokio::process::Command::new(&python)
        .no_window()
        .args(["-m", "autotimm.flow.augmentation_preview", "--image", &image_path, "--preset", &preset])
        .current_dir(&pp)
        .output()
        .await;

    let _ = std::fs::remove_file(&tmp_path);

    let output = output.map_err(|e| format!("Failed to run augmentation preview: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Augmentation preview failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let result: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Invalid JSON output: {e}"))?;

    if let Some(error) = result.get("error").and_then(|e| e.as_str()) {
        return Err(error.to_string());
    }

    if let Some(arr) = result.as_array() {
        Ok(arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect())
    } else {
        Err("Unexpected output format".to_string())
    }
}

/// Export a trained checkpoint to TorchScript (JIT) format for Netron viewing.
///
/// Finds the checkpoint in `logs/{run_id}/checkpoints/`, exports to JIT `.pt`,
/// and returns the path to the exported file.
#[command]
pub async fn export_jit_model(
    project_path: String,
    run_id: String,
    task_class: Option<String>,
    ssh_command: Option<String>,
) -> Result<String, String> {
    let pp = expand_tilde(project_path.trim_end_matches('/').trim_end_matches('\\'));
    let pp_path = PathBuf::from(&pp);
    let run_logs_dir = pp_path.join("logs").join(&run_id);
    let ckpt_dir = run_logs_dir.join("checkpoints");
    let output_path = run_logs_dir.join("model.pt");
    let ckpt_dir_str = ckpt_dir.to_string_lossy().to_string();
    let output_path_str = output_path.to_string_lossy().to_string();
    let tc = task_class.unwrap_or_else(|| "ImageClassifier".to_string());

    // Locate hparams.yaml
    let hparams_base = run_logs_dir.clone();
    let hparams_candidates = [
        hparams_base.join("hparams.yaml"),
        hparams_base.join("version_0").join("hparams.yaml"),
    ];
    let hparams_path = hparams_candidates.iter().find(|p| p.exists());

    // Return cached export if it already exists
    if output_path.exists() {
        return Ok(output_path_str);
    }

    if let Some(ssh_cmd) = ssh_command {
        // ── Remote execution via SSH ────────────────────────────────────
        let parts: Vec<String> = ssh_cmd.split_whitespace().map(String::from).collect();
        if parts.len() < 2 {
            return Err("Invalid SSH command".to_string());
        }

        // Find checkpoint remotely
        let find_script = format!(
            r#"find "{ckpt_dir_str}" -name "*.ckpt" -type f 2>/dev/null | head -1"#
        );
        let find_output = tokio::process::Command::new(&parts[0])
            .no_window()
            .args(&parts[1..])
            .arg(&find_script)
            .output()
            .await
            .map_err(|e| format!("SSH failed: {e}"))?;

        let remote_ckpt = String::from_utf8_lossy(&find_output.stdout)
            .trim()
            .to_string();
        if remote_ckpt.is_empty() {
            return Err(
                "No checkpoint found. Training may not have saved a model yet.".to_string(),
            );
        }

        // Resolve python (prefer venv)
        let venv_python = format!("{pp}/.venv/bin/python");
        let python_cmd = format!(
            "if [ -x \"{venv_python}\" ]; then echo \"{venv_python}\"; else echo python3; fi"
        );
        let py_output = tokio::process::Command::new(&parts[0])
            .no_window()
            .args(&parts[1..])
            .arg(&python_cmd)
            .output()
            .await
            .map_err(|e| format!("SSH python check failed: {e}"))?;
        let python = String::from_utf8_lossy(&py_output.stdout)
            .trim()
            .to_string();

        // Run export remotely — cd into logs/{run_id}/
        let run_dir_str = run_logs_dir.to_string_lossy();
        let hparams_arg_str = run_logs_dir.join("hparams.yaml").to_string_lossy().to_string();
        let run_cmd = format!(
            "cd \"{run_dir_str}\" && {python} -m autotimm.export.export_jit --checkpoint \"{remote_ckpt}\" --output \"{output_path_str}\" --task-class \"{tc}\" --hparams-yaml \"{hparams_arg_str}\""
        );

        let output = tokio::process::Command::new(&parts[0])
            .no_window()
            .args(&parts[1..])
            .arg(&run_cmd)
            .output()
            .await
            .map_err(|e| format!("SSH JIT export failed: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("JIT export failed: {stderr}"));
        }

        // SCP the .pt file back to local temp
        let local_output = std::env::temp_dir()
            .join("nightflow_netron")
            .join(&run_id);
        let _ = std::fs::create_dir_all(&local_output);
        let local_pt = local_output.join("model.pt");

        // Parse SSH command to build SCP args
        let mut scp_args: Vec<String> = Vec::new();
        let mut host_part = String::new();
        let mut i = 1;
        while i < parts.len() {
            if parts[i] == "-p" || parts[i] == "-i" || parts[i] == "-o" {
                scp_args.push(if parts[i] == "-p" {
                    "-P".to_string()
                } else {
                    parts[i].clone()
                });
                if i + 1 < parts.len() {
                    scp_args.push(parts[i + 1].clone());
                    i += 2;
                } else {
                    i += 1;
                }
            } else {
                host_part = parts[i].clone();
                i += 1;
            }
        }

        let scp_source = format!("{host_part}:{output_path_str}");
        scp_args.push(scp_source);
        scp_args.push(local_pt.to_string_lossy().to_string());

        let scp_result = tokio::process::Command::new("scp")
            .no_window()
            .args(&scp_args)
            .output()
            .await
            .map_err(|e| format!("SCP failed: {e}"))?;

        if !scp_result.status.success() {
            let stderr = String::from_utf8_lossy(&scp_result.stderr);
            return Err(format!("SCP download failed: {stderr}"));
        }

        Ok(local_pt.to_string_lossy().to_string())
    } else {
        // ── Local execution ─────────────────────────────────────────────
        let mut best_ckpt: Option<PathBuf> = None;

        if let Ok(entries) = std::fs::read_dir(&ckpt_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str())
                    && name.ends_with(".ckpt")
                {
                    best_ckpt = Some(path);
                }
            }
        }

        let ckpt = best_ckpt
            .ok_or("No checkpoint found. Training may not have saved a model yet.")?;

        // Resolve python: prefer project venv, then system python
        let venv_python = crate::env::venv_python(&PathBuf::from(&pp).join(".venv"));
        let python = if venv_python.exists() {
            venv_python.to_string_lossy().to_string()
        } else {
            crate::env::python_cmd().to_string()
        };

        // Run from logs/{run_id}/
        let cwd = if run_logs_dir.exists() { run_logs_dir.clone() } else { PathBuf::from(&pp) };

        let mut cmd = tokio::process::Command::new(&python);
        cmd.no_window();
        cmd.arg("-m")
            .arg("autotimm.export.export_jit")
            .arg("--checkpoint")
            .arg(ckpt.to_string_lossy().to_string())
            .arg("--output")
            .arg(&output_path_str)
            .arg("--task-class")
            .arg(&tc);
        if let Some(hp) = &hparams_path {
            cmd.arg("--hparams-yaml").arg(hp.to_string_lossy().to_string());
        }
        cmd.current_dir(&cwd);

        let output = cmd
            .output()
            .await
            .map_err(|e| format!("Failed to run JIT export: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("JIT export failed: {stderr}"));
        }

        Ok(output_path_str)
    }
}

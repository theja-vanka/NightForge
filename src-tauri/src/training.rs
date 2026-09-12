use std::collections::HashMap;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Emitter, State, command};

use crate::expand_tilde;
use crate::env::{get_shell_env, resolve_conda_path};
#[cfg(windows)]
use crate::StdCommandNoWindow;

const TRAINING_META_FILE: &str = ".nightflow_training.json";
const TRAINING_LOG_FILE_DEFAULT: &str = "training_events.jsonl";

/// Kill a process and its entire process tree.
/// On Unix we used `setsid()` when spawning, so the child is a session/group
/// leader — sending the signal to the negative PID kills the whole group.
fn kill_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }
    #[cfg(unix)]
    unsafe {
        // Kill the entire process group (negative PID)
        libc::kill(-(pid as i32), libc::SIGTERM);
        // Also send SIGTERM to the process itself in case it's not in its own group
        libc::kill(pid as i32, libc::SIGTERM);
    }
    #[cfg(windows)]
    {
        // /T = kill child processes, /F = force
        let _ = std::process::Command::new("taskkill")
            .no_window()
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

/// Managed state for training processes (keyed by project/session id).
pub struct TrainingState {
    pub processes: Mutex<HashMap<String, TrainingProcess>>,
}

pub struct TrainingProcess {
    child: Option<tokio::process::Child>,
    alive: Arc<AtomicBool>,
    _log_file: String,
}

/// Metadata persisted to disk so we can reconnect after an app crash.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct TrainingMeta {
    pid: u32,
    session_id: String,
    run_id: String,
    log_file: String,
    command: String,
    started_at: f64,
}

#[derive(serde::Serialize, Clone)]
struct TrainingEvent {
    session_id: String,
    data: serde_json::Value,
}

#[derive(serde::Serialize, Clone)]
struct TrainingLog {
    session_id: String,
    data: String,
}

/// Check whether a PID is still alive (Unix: kill(pid, 0)).
fn is_pid_alive(pid: u32) -> bool {
    if pid == 0 { return false; }
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Threading::{OpenProcess, GetExitCodeProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        use windows_sys::Win32::Foundation::CloseHandle;
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() { return false; }
        let mut code = 0;
        let ok = GetExitCodeProcess(handle, &mut code) != 0;
        CloseHandle(handle);
        ok && code == 259 // STILL_ACTIVE
    }
    #[cfg(not(any(unix, windows)))]
    { false }
}

fn meta_path(project_dir: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(expand_tilde(project_dir)).join(TRAINING_META_FILE)
}

fn log_path(project_dir: &str, run_id: Option<&str>) -> std::path::PathBuf {
    match run_id {
        Some(id) if !id.is_empty() => std::path::PathBuf::from(expand_tilde(project_dir))
            .join("logs")
            .join(id)
            .join(format!("{}.jsonl", id)),
        _ => std::path::PathBuf::from(expand_tilde(project_dir)).join(TRAINING_LOG_FILE_DEFAULT),
    }
}

fn write_training_meta(project_dir: &str, meta: &TrainingMeta) -> Result<(), String> {
    let path = meta_path(project_dir);
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Failed to write training meta: {}", e))
}

fn read_training_meta(project_dir: &str) -> Option<TrainingMeta> {
    let path = meta_path(project_dir);
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn remove_training_meta(project_dir: &str) {
    let _ = std::fs::remove_file(meta_path(project_dir));
}

fn read_complete_lines(path: &std::path::Path, offset: &mut u64) -> std::io::Result<Vec<String>> {
    use std::io::{BufRead, Seek, SeekFrom};
    let mut file = std::fs::File::open(path)?;
    if file.metadata()?.len() < *offset { *offset = 0; }
    file.seek(SeekFrom::Start(*offset))?;
    let mut reader = std::io::BufReader::new(file);
    let mut lines = Vec::new();
    loop {
        let mut bytes = Vec::new();
        let count = reader.read_until(b'\n', &mut bytes)?;
        if count == 0 || bytes.last() != Some(&b'\n') { break; }
        *offset += count as u64;
        lines.push(String::from_utf8_lossy(&bytes).trim_end_matches(['\r', '\n']).to_string());
    }
    Ok(lines)
}

#[allow(clippy::too_many_arguments)]
fn spawn_tail_task(
    path: std::path::PathBuf,
    alive: Arc<AtomicBool>,
    is_json: bool,
    prefix: Option<String>,
    app: tauri::AppHandle,
    session_id: String,
    buf: Option<Arc<Mutex<Vec<String>>>>,
    skip_events: Option<Vec<String>>,
) {
    tokio::spawn(async move {
        let mut offset = 0;
        loop {
            let is_alive = alive.load(Ordering::SeqCst);
            if let Ok(lines) = read_complete_lines(&path, &mut offset) {
                    for line in lines {
                        if is_json {
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                                // Skip filtered event types (e.g. training_complete from fit stdout)
                                if let Some(ref skip) = skip_events
                                    && let Some(evt) = json.get("event").and_then(|v| v.as_str())
                                    && skip.iter().any(|s| s == evt)
                                {
                                    continue;
                                }
                                let _ = app.emit(
                                    "training-event",
                                    TrainingEvent {
                                        session_id: session_id.clone(),
                                        data: json,
                                    },
                                );
                            }
                        } else {
                            let display_line = if let Some(ref p) = prefix {
                                format!("{} {}", p, line)
                            } else {
                                line.clone()
                            };
                            let _ = app.emit(
                                "training-log",
                                TrainingLog {
                                    session_id: session_id.clone(),
                                    data: display_line,
                                },
                            );
                            if let Some(ref b_mutex) = buf
                                && let Ok(mut b) = b_mutex.lock()
                            {
                                b.push(line);
                                if b.len() > 20 {
                                    b.remove(0);
                                }
                            }
                        }
                    }
            }
            if !is_alive {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
    });
}

#[derive(serde::Deserialize)]
struct StepsCommand {
    mode: String,
    env_path: String,
    config_path: String,
    steps: String,
}

fn parse_steps_command(command: &str) -> Result<Option<StepsCommand>, String> {
    let parsed = if let Some(json) = command.strip_prefix("__STEPS_JSON__:") {
        serde_json::from_str::<StepsCommand>(json).map_err(|e| format!("Invalid training command: {e}"))?
    } else if let Some(rest) = command.strip_prefix("__STEPS__:") {
        let parts: Vec<&str> = rest.splitn(4, ':').collect();
        if parts.len() < 3 { return Err("Malformed legacy training command".into()); }
        StepsCommand { mode: parts[0].into(), env_path: parts[1].into(), config_path: parts[2].into(), steps: parts.get(3).copied().unwrap_or("fit+test").into() }
    } else { return Ok(None); };
    if !matches!(parsed.mode.as_str(), "direct" | "conda") || !matches!(parsed.steps.as_str(), "fit" | "test" | "fit+test") || parsed.env_path.is_empty() || parsed.config_path.is_empty() {
        return Err("Invalid training mode, paths, or steps".into());
    }
    Ok(Some(parsed))
}

#[command]
pub async fn start_training(
    app: tauri::AppHandle,
    state: State<'_, TrainingState>,
    session_id: String,
    run_id: String,
    _run_name: Option<String>,
    command: String,
    cwd: Option<String>,
) -> Result<(), String> {
    // Don't allow two training processes for the same session
    {
        let procs = state.processes.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if procs
            .get(&session_id)
            .map(|p| p.alive.load(Ordering::SeqCst))
            .unwrap_or(false)
        {
            return Err("Training already running for this session".into());
        }
    }

    let resolved_cwd = cwd
        .as_deref()
        .map(expand_tilde)
        .unwrap_or_else(|| ".".to_string());

    let log_file_path = log_path(&resolved_cwd, Some(&run_id));
    let log_file_str = log_file_path.to_string_lossy().to_string();

    // ── Structured multi-step command ─────────────────────────────────────────
    if let Some(parsed) = parse_steps_command(&command)? {
        let mode = parsed.mode;
        let env_path = expand_tilde(&parsed.env_path);
        let config_path = expand_tilde(&parsed.config_path);
        let steps = parsed.steps;
        let run_fit = steps.contains("fit");
        let run_test = steps.contains("test");

        let alive = Arc::new(AtomicBool::new(true));

        {
            let mut procs = state.processes.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
            procs.insert(
                session_id.clone(),
                TrainingProcess {
                    child: None,
                    alive: Arc::clone(&alive),
                    _log_file: log_file_str.clone(),
                },
            );
        }

        let meta = TrainingMeta {
            pid: 0,
            session_id: session_id.clone(),
            run_id: run_id.clone(),
            log_file: log_file_str.clone(),
            command: command.clone(),
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64(),
        };
        write_training_meta(&resolved_cwd, &meta)?;

        let sid = session_id.clone();
        let app2 = app.clone();
        let cwd2 = resolved_cwd.clone();
        let alive2 = Arc::clone(&alive);

        tokio::spawn(async move {
            let base_prefix: Vec<String> = match mode.as_str() {
                "conda" => {
                    let conda_bin = match resolve_conda_path().await {
                        Some(p) => p,
                        None => {
                            let _ = app2.emit("training-event", TrainingEvent {
                                session_id: sid.clone(),
                                data: serde_json::json!({ "event": "training_error", "error": "conda not found — cannot start training" }),
                            });
                            alive2.store(false, Ordering::SeqCst);
                            remove_training_meta(&cwd2);
                            return;
                        }
                    };
                    vec![
                        conda_bin,
                        "run".into(),
                        "--live-stream".into(),
                        "-p".into(),
                        env_path.clone(),
                        "python".into(),
                    ]
                }
                "direct" => vec![env_path.clone()],
                other => {
                    let _ = app2.emit("training-event", TrainingEvent {
                        session_id: sid.clone(),
                        data: serde_json::json!({ "event": "training_error", "error": format!("Unknown __STEPS__ mode: {}", other) }),
                    });
                    alive2.store(false, Ordering::SeqCst);
                    remove_training_meta(&cwd2);
                    return;
                }
            };

            let tb_jsonl_path = std::path::Path::new("logs").join(&run_id).join(format!("{}.jsonl", run_id));
            let tb_jsonl_path = tb_jsonl_path.to_string_lossy().to_string();
            let progress_args: Vec<String> = vec![
                "--trainer.json_progress=true".into(),
                format!("--trainer.json_progress_log_file={}", tb_jsonl_path),
            ];

            let make_step_args = |subcommand: &str, extra: &[String]| -> Vec<String> {
                let mut args = base_prefix.clone();
                args.extend(["-m".into(), "autotimm".into(), subcommand.into()]);
                args.push("--config".into());
                args.push(config_path.clone());
                args.extend_from_slice(extra);
                args
            };

            let fit_args  = make_step_args("fit",  &progress_args);
            let test_args = make_step_args("test", &[]);

            let shell_env = get_shell_env().await;

            let logs_dir = std::path::Path::new(&cwd2).join("logs").join(&run_id);
            let _ = std::fs::create_dir_all(&logs_dir);

            let mut fit_failed = false;
            let mut terminal_error: Option<String> = None;

            // ── Step 1: fit ─────────────────────────────────────────────────
            if run_fit && alive2.load(Ordering::SeqCst) {
                let fit_stdout_path = logs_dir.join("fit_stdout.log");
                let fit_stderr_path = logs_dir.join("fit_stderr.log");
                let fit_stdout_file = match std::fs::OpenOptions::new().create(true).append(true).open(&fit_stdout_path) {
                    Ok(f) => f,
                    Err(e) => {
                        let _ = app2.emit("training-event", TrainingEvent {
                            session_id: sid.clone(),
                            data: serde_json::json!({ "event": "training_error", "error": format!("Failed to open fit stdout log: {}", e) }),
                        });
                        alive2.store(false, Ordering::SeqCst);
                        remove_training_meta(&cwd2);
                        return;
                    }
                };
                let fit_stderr_file = match std::fs::OpenOptions::new().create(true).append(true).open(&fit_stderr_path) {
                    Ok(f) => f,
                    Err(e) => {
                        let _ = app2.emit("training-event", TrainingEvent {
                            session_id: sid.clone(),
                            data: serde_json::json!({ "event": "training_error", "error": format!("Failed to open fit stderr log: {}", e) }),
                        });
                        alive2.store(false, Ordering::SeqCst);
                        remove_training_meta(&cwd2);
                        return;
                    }
                };

                let mut fit_cmd = tokio::process::Command::new(&fit_args[0]);
                fit_cmd.args(&fit_args[1..]);
                fit_cmd.current_dir(&cwd2);
                fit_cmd.stdout(std::process::Stdio::from(fit_stdout_file));
                fit_cmd.stderr(std::process::Stdio::from(fit_stderr_file));
                fit_cmd.kill_on_drop(false);
                if !shell_env.is_empty() {
                    fit_cmd.env_clear();
                    fit_cmd.envs(&shell_env);
                }
                #[cfg(unix)]
                unsafe { fit_cmd.pre_exec(|| { libc::setsid(); Ok(()) }); }
                #[cfg(windows)]
                { fit_cmd.creation_flags(0x00000200 | 0x08000000); } // CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW

                let mut fit_child = match fit_cmd.spawn() {
                    Ok(c) => c,
                    Err(e) => {
                        let _ = app2.emit("training-event", TrainingEvent {
                            session_id: sid.clone(),
                            data: serde_json::json!({ "event": "training_error", "error": format!("fit failed to spawn: {}", e) }),
                        });
                        alive2.store(false, Ordering::SeqCst);
                        remove_training_meta(&cwd2);
                        return;
                    }
                };

                let fit_pid = fit_child.id().unwrap_or(0);
                if !alive2.load(Ordering::SeqCst) {
                    kill_process_tree(fit_pid);
                    let _ = fit_child.kill().await;
                    remove_training_meta(&cwd2);
                    return;
                }
                let updated_meta = TrainingMeta {
                    pid: fit_pid,
                    session_id: sid.clone(),
                    run_id: run_id.clone(),
                    log_file: log_file_str.clone(),
                    command: command.clone(),
                    started_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs_f64(),
                };
                let _ = write_training_meta(&cwd2, &updated_meta);

                spawn_tail_task(
                    fit_stdout_path,
                    Arc::clone(&alive2),
                    true,
                    None,
                    app2.clone(),
                    sid.clone(),
                    None,
                    // Skip training_complete from fit stdout — Rust emits its own
                    // after both fit+test finish. Without this, the frontend sets
                    // active=false and drops all subsequent test events.
                    Some(vec!["training_complete".to_string()]),
                );

                let fit_stderr_buf: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
                spawn_tail_task(
                    fit_stderr_path,
                    Arc::clone(&alive2),
                    false,
                    None,
                    app2.clone(),
                    sid.clone(),
                    Some(Arc::clone(&fit_stderr_buf)),
                    None,
                );

                let fit_ok = fit_child.wait().await.map(|s| s.success()).unwrap_or(false);

                if !fit_ok || !alive2.load(Ordering::SeqCst) {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    let stderr_tail = fit_stderr_buf.lock().map(|b| b.join("\n")).unwrap_or_default();
                    let error_msg = if stderr_tail.is_empty() {
                        "fit step failed".to_string()
                    } else {
                        format!("fit step failed:\n{}", stderr_tail)
                    };
                    terminal_error = Some(error_msg);
                    fit_failed = true;
                }
            }

            // ── Step 2: test ────────────────────────────────────────────────
            if run_test && !fit_failed && alive2.load(Ordering::SeqCst) {
                let test_stdout_path = logs_dir.join("test_stdout.log");
                let test_stderr_path = logs_dir.join("test_stderr.log");
                let test_stdout_file = match std::fs::OpenOptions::new().create(true).append(true).open(&test_stdout_path) {
                    Ok(f) => f,
                    Err(e) => {
                        let _ = app2.emit("training-event", TrainingEvent {
                            session_id: sid.clone(),
                            data: serde_json::json!({ "event": "training_error", "error": format!("Failed to open test stdout log: {}", e) }),
                        });
                        alive2.store(false, Ordering::SeqCst);
                        remove_training_meta(&cwd2);
                        return;
                    }
                };
                let test_stderr_file = match std::fs::OpenOptions::new().create(true).append(true).open(&test_stderr_path) {
                    Ok(f) => f,
                    Err(e) => {
                        let _ = app2.emit("training-event", TrainingEvent {
                            session_id: sid.clone(),
                            data: serde_json::json!({ "event": "training_error", "error": format!("Failed to open test stderr log: {}", e) }),
                        });
                        alive2.store(false, Ordering::SeqCst);
                        remove_training_meta(&cwd2);
                        return;
                    }
                };

                let test_progress_args: Vec<String> = vec![
                    "--trainer.json_progress=true".into(),
                    format!("--trainer.json_progress_log_file={}", tb_jsonl_path),
                ];
                let mut test_full_args = test_args.clone();
                test_full_args.extend(test_progress_args);

                let mut c = tokio::process::Command::new(&test_full_args[0]);
                c.args(&test_full_args[1..]);
                c.current_dir(&cwd2);
                c.stdout(std::process::Stdio::from(test_stdout_file));
                c.stderr(std::process::Stdio::from(test_stderr_file));
                c.kill_on_drop(false);
                if !shell_env.is_empty() {
                    c.env_clear();
                    c.envs(&shell_env);
                }
                #[cfg(unix)]
                unsafe { c.pre_exec(|| { libc::setsid(); Ok(()) }); }
                #[cfg(windows)]
                { c.creation_flags(0x00000200 | 0x08000000); } // CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
                match c.spawn() {
                    Ok(mut child) => {
                        let test_meta = TrainingMeta {
                            pid: child.id().unwrap_or(0), session_id: sid.clone(), run_id: run_id.clone(),
                            log_file: log_file_str.clone(), command: command.clone(),
                            started_at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs_f64(),
                        };
                        let _ = write_training_meta(&cwd2, &test_meta);
                        if !alive2.load(Ordering::SeqCst) {
                            if let Some(pid) = child.id() { kill_process_tree(pid); }
                            let _ = child.kill().await;
                            remove_training_meta(&cwd2);
                            return;
                        }
                        spawn_tail_task(
                            test_stdout_path,
                            Arc::clone(&alive2),
                            true,
                            None,
                            app2.clone(),
                            sid.clone(),
                            None,
                            None,
                        );
                        spawn_tail_task(
                            test_stderr_path,
                            Arc::clone(&alive2),
                            false,
                            Some("[test]".to_string()),
                            app2.clone(),
                            sid.clone(),
                            None,
                            None,
                        );
                        let test_ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
                        if !test_ok {
                            fit_failed = true;
                            terminal_error = Some("Evaluation process failed; see test stderr log.".into());
                        }
                        // Give tail tasks time to drain remaining events
                        // before we set alive=false and emit training_complete
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    }
                    Err(e) => {
                        terminal_error = Some(format!("test step failed to spawn: {}", e));
                        fit_failed = true;
                    }
                }
            }

            let completed = !fit_failed && alive2.load(Ordering::SeqCst);
            alive2.store(false, Ordering::SeqCst);
            remove_training_meta(&cwd2);
            if let Some(error) = terminal_error {
                let _ = app2.emit("training-event", TrainingEvent {
                    session_id: sid.clone(),
                    data: serde_json::json!({ "event": "training_error", "error": error }),
                });
            } else if completed {
                let _ = app2.emit("training-event", TrainingEvent {
                    session_id: sid.clone(),
                    data: serde_json::json!({ "event": "training_complete" }),
                });
            }
        });

        return Ok(());
    }

    // ── Legacy fallback: raw command string ──────────────────────────────────
    let parts: Vec<String> = command.split_whitespace().map(String::from).collect();
    if parts.is_empty() {
        return Err("Empty training command".into());
    }

    let mut final_parts = parts.clone();
    if !final_parts.iter().any(|a| a.contains("json_progress=")) {
        final_parts.push("--trainer.json_progress=true".into());
    }
    let tb_jsonl_path = std::path::Path::new("logs").join(&run_id).join(format!("{}.jsonl", run_id));
    let tb_jsonl_path = tb_jsonl_path.to_string_lossy().to_string();
    if !final_parts
        .iter()
        .any(|a| a.contains("--trainer.json_progress_log_file"))
    {
        final_parts.push(format!(
            "--trainer.json_progress_log_file={}",
            tb_jsonl_path
        ));
    }

    let raw_executable = expand_tilde(&final_parts[0]);
    let executable = if raw_executable == "conda" {
        resolve_conda_path().await.unwrap_or(raw_executable)
    } else {
        raw_executable
    };
    let logs_dir = std::path::Path::new(&resolved_cwd).join("logs").join(&run_id);
    let _ = std::fs::create_dir_all(&logs_dir);

    let stdout_path = logs_dir.join("stdout.log");
    let stderr_path = logs_dir.join("stderr.log");
    let stdout_file = std::fs::OpenOptions::new().create(true).append(true).open(&stdout_path).map_err(|e| e.to_string())?;
    let stderr_file = std::fs::OpenOptions::new().create(true).append(true).open(&stderr_path).map_err(|e| e.to_string())?;

    let mut cmd = tokio::process::Command::new(&executable);
    for arg in &final_parts[1..] {
        cmd.arg(arg);
    }
    cmd.current_dir(&resolved_cwd);
    cmd.stdout(std::process::Stdio::from(stdout_file));
    cmd.stderr(std::process::Stdio::from(stderr_file));
    cmd.kill_on_drop(false);

    #[cfg(unix)]
    unsafe {
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    #[cfg(windows)]
    {
        cmd.creation_flags(0x00000200 | 0x08000000); // CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
    }

    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id().unwrap_or(0);
    let alive = Arc::new(AtomicBool::new(true));

    let meta = TrainingMeta {
        pid,
        session_id: session_id.clone(),
        run_id: run_id.clone(),
        log_file: log_file_str.clone(),
        command: command.clone(),
        started_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64(),
    };
    write_training_meta(&resolved_cwd, &meta)?;

    {
        let mut procs = state.processes.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        procs.insert(
            session_id.clone(),
            TrainingProcess {
                child: Some(child),
                alive: Arc::clone(&alive),
                _log_file: log_file_str.clone(),
            },
        );
    }

    let cwd_out = resolved_cwd.clone();
    let alive_out = Arc::clone(&alive);
    spawn_tail_task(
        stdout_path,
        Arc::clone(&alive),
        true,
        None,
        app.clone(),
        session_id.clone(),
        None,
        None,
    );

    tokio::spawn(async move {
        loop {
            if !alive_out.load(Ordering::SeqCst) || !is_pid_alive(pid) {
                alive_out.store(false, Ordering::SeqCst);
                remove_training_meta(&cwd_out);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    });

    spawn_tail_task(
        stderr_path,
        Arc::clone(&alive),
        false,
        None,
        app.clone(),
        session_id.clone(),
        None,
        None,
    );

    Ok(())
}

#[command]
pub async fn stop_training(
    state: State<'_, TrainingState>,
    session_id: String,
    project_path: Option<String>,
) -> Result<(), String> {
    let mut child_to_kill = None;
    {
        let mut procs = state.processes.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if let Some(proc) = procs.get_mut(&session_id) {
            proc.alive.store(false, Ordering::SeqCst);
            child_to_kill = proc.child.take();
        }
        procs.remove(&session_id);
    }
    if let Some(ref mut child) = child_to_kill {
        // Kill the process group first (covers child subprocesses), then the handle
        if let Some(pid) = child.id() {
            kill_process_tree(pid);
        }
        let _ = child.kill().await;
    }
    if let Some(ref dir) = project_path {
        let expanded = expand_tilde(dir);
        if let Some(meta) = read_training_meta(&expanded)
            && meta.pid != 0
            && is_pid_alive(meta.pid)
        {
            kill_process_tree(meta.pid);
        }
        remove_training_meta(&expanded);
    }
    Ok(())
}

#[command]
pub async fn force_reset_training(
    state: State<'_, TrainingState>,
    session_id: String,
    project_path: Option<String>,
) -> Result<(), String> {
    // Kill process if it's still alive
    let mut child_to_kill = None;
    {
        let mut procs = state.processes.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
        if let Some(proc) = procs.get_mut(&session_id) {
            proc.alive.store(false, Ordering::SeqCst);
            child_to_kill = proc.child.take();
        }
        procs.remove(&session_id);
    }
    if let Some(mut child) = child_to_kill {
        let _ = child.kill().await;
    }
    // Also kill any orphaned process from meta file
    if let Some(ref dir) = project_path {
        let expanded = expand_tilde(dir);
        if let Some(meta) = read_training_meta(&expanded)
            && meta.pid != 0
            && is_pid_alive(meta.pid)
        {
            kill_process_tree(meta.pid);
        }
        remove_training_meta(&expanded);
    }
    Ok(())
}

#[command]
pub fn is_training_alive(session_id: String, state: State<'_, TrainingState>) -> bool {
    let Ok(procs) = state.processes.lock() else { return false };
    procs
        .get(&session_id)
        .map(|p| p.alive.load(Ordering::SeqCst))
        .unwrap_or(false)
}

#[derive(serde::Serialize)]
pub struct OrphanedSession {
    found: bool,
    alive: bool,
    meta: Option<TrainingMeta>,
}

#[command]
pub fn check_training_session(project_path: String) -> OrphanedSession {
    let expanded = expand_tilde(&project_path);
    match read_training_meta(&expanded) {
        Some(meta) => {
            let alive = is_pid_alive(meta.pid);
            OrphanedSession {
                found: true,
                alive,
                meta: Some(meta),
            }
        }
        None => OrphanedSession {
            found: false,
            alive: false,
            meta: None,
        },
    }
}

#[command]
pub fn read_training_log(log_file: String) -> Result<Vec<serde_json::Value>, String> {
    let expanded = expand_tilde(&log_file);
    let content = std::fs::read_to_string(&expanded)
        .map_err(|e| format!("Failed to read log file: {}", e))?;
    let mut events = Vec::new();
    for line in content.lines() {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
            events.push(json);
        }
    }
    Ok(events)
}

#[command]
pub async fn watch_training_log(
    app: tauri::AppHandle,
    session_id: String,
    log_file: String,
    pid: u32,
) -> Result<(), String> {
    use std::io::{BufRead, Seek, SeekFrom};

    let expanded = expand_tilde(&log_file);
    let path = std::path::PathBuf::from(&expanded);

    let mut offset = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        if !is_pid_alive(pid) {
            if let Ok(mut f) = std::fs::File::open(&path)
                && f.seek(SeekFrom::Start(offset)).is_ok() {
                let reader = std::io::BufReader::new(f);
                for line in reader.lines().map_while(Result::ok) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        let _ = app.emit(
                            "training-event",
                            TrainingEvent {
                                session_id: session_id.clone(),
                                data: json,
                            },
                        );
                    }
                }
            }
            if let Some(parent) = path.parent() {
                remove_training_meta(&parent.to_string_lossy());
            }
            break;
        }

        let current_size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(offset);
        if current_size > offset {
            if let Ok(mut f) = std::fs::File::open(&path)
                && f.seek(SeekFrom::Start(offset)).is_ok()
            {
                let reader = std::io::BufReader::new(&mut f);
                for line in reader.lines().map_while(Result::ok) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                        let _ = app.emit(
                            "training-event",
                            TrainingEvent {
                                session_id: session_id.clone(),
                                data: json,
                            },
                        );
                    }
                }
            }
            offset = current_size;
        }
    }
    Ok(())
}

#[cfg(test)]
mod command_tests {
    use super::*;
    #[test]
    fn structured_paths_preserve_colons_and_spaces() {
        let command = format!("__STEPS_JSON__:{}", serde_json::json!({"mode":"direct", "env_path":r"C:\My Project\python.exe", "config_path":r"C:\My Project\config.yaml", "steps":"fit+test"}));
        let parsed = parse_steps_command(&command).unwrap().unwrap();
        assert_eq!(parsed.env_path, r"C:\My Project\python.exe");
        assert_eq!(parsed.config_path, r"C:\My Project\config.yaml");
    }
    #[test]
    fn zero_pid_is_not_a_process() { assert!(!is_pid_alive(0)); }
    #[test]
    fn log_reader_preserves_partial_events() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("nightflow-log-test-{}", std::process::id()));
        std::fs::write(&path, b"first\n{\"event\":").unwrap();
        let mut offset = 0;
        assert_eq!(read_complete_lines(&path, &mut offset).unwrap(), vec!["first"]);
        assert_eq!(offset, 6);
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"\"done\"}\n").unwrap();
        assert_eq!(read_complete_lines(&path, &mut offset).unwrap(), vec!["{\"event\":\"done\"}"]);
        std::fs::write(&path, b"new\n").unwrap();
        assert_eq!(read_complete_lines(&path, &mut offset).unwrap(), vec!["new"]);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_invalid_steps() {
        assert!(parse_steps_command("__STEPS__:direct:python:config.yaml:misfit").is_err());
        assert!(parse_steps_command("__STEPS_JSON__:{}").is_err());
        assert!(parse_steps_command("python -m autotimm fit").unwrap().is_none());
    }
}

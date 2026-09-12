#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod env;
mod fs;
mod interpretation;
mod pty;
mod runs;
mod ssh;
mod system;
mod training;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{Manager, command, window::Color};
use tauri::menu::{AboutMetadata, MenuBuilder, SubmenuBuilder};

// ── Hide console windows on Windows ─────────────────────────────────────────
//
// On Windows, spawning a subprocess via std::process::Command or
// tokio::process::Command opens a visible console window by default.
// These traits add a `.no_window()` builder method that sets the
// CREATE_NO_WINDOW flag (0x08000000) on Windows and is a no-op elsewhere.

#[cfg(windows)]
use std::os::windows::process::CommandExt as _;

#[cfg(windows)]
const _CREATE_NO_WINDOW: u32 = 0x08000000;

pub trait StdCommandNoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl StdCommandNoWindow for std::process::Command {
    #[inline]
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(_CREATE_NO_WINDOW);
        }
        self
    }
}

pub trait TokioCommandNoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl TokioCommandNoWindow for tokio::process::Command {
    #[inline]
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(_CREATE_NO_WINDOW);
        }
        self
    }
}

// ── Shared utility ───────────────────────────────────────────────────────────

/// Cross-platform home directory: HOME (Unix), USERPROFILE (Windows),
/// or HOMEDRIVE+HOMEPATH (Windows fallback).
pub fn home_dir() -> Option<String> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .or({
            #[cfg(target_os = "windows")]
            if let (Ok(drive), Ok(path)) =
                (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH"))
            {
                return Some(format!("{}{}", drive, path));
            }
            None
        })
}

/// Cross-platform default shell: SHELL on Unix, COMSPEC on Windows.
pub fn default_shell() -> String {
    if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
    }
}

pub fn expand_tilde(path: &str) -> String {
    if !path.starts_with('~') {
        return path.to_string();
    }
    if let Some(home) = home_dir() {
        return path.replacen('~', &home, 1);
    }
    path.to_string()
}

// ── Misc commands ────────────────────────────────────────────────────────────

#[command]
fn get_platform() -> String {
    if cfg!(windows) {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "macos".to_string()
    } else {
        "linux".to_string()
    }
}

#[command]
fn close_splash(app: tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
    }
}

// ── Window control commands (for custom titlebar on Windows) ────────────────

#[command]
fn window_minimize(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.minimize();
    }
}

#[command]
fn window_maximize(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_maximized().unwrap_or(false) {
            let _ = win.unmaximize();
        } else {
            let _ = win.maximize();
        }
    }
}

#[command]
fn window_close(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

// ── Windows 11 version check ────────────────────────────────────────────────

/// Ensures the app only runs on Windows 11 (build 22000) or later.
#[cfg(target_os = "windows")]
fn check_windows_version() {
    use windows_sys::Win32::System::SystemInformation::{GetVersionExW, OSVERSIONINFOW};
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    let ok = unsafe { GetVersionExW(&mut info) };
    if ok == 0 || info.dwBuildNumber < 22000 {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_OK, MB_ICONERROR};
        let title: Vec<u16> = "NightFlow\0".encode_utf16().collect();
        let msg: Vec<u16> = "NightFlow requires Windows 11 (build 22000) or later.\0"
            .encode_utf16().collect();
        unsafe {
            MessageBoxW(std::ptr::null_mut(), msg.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR);
        }
        std::process::exit(1);
    }
}

// ── Entry point ──────────────────────────────────────────────────────────────

fn main() {
    #[cfg(target_os = "windows")]
    check_windows_version();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState {
            sessions: Mutex::new(HashMap::new()),
        })
        .manage(training::TrainingState {
            processes: Mutex::new(HashMap::new()),
        })
        .setup(|app| {
            if let Some(splash) = app.get_webview_window("splashscreen") {
                let _ = splash.set_background_color(Some(Color(0, 0, 0, 0)));
            }

            // On Windows 11: remove native decorations and apply Mica backdrop
            #[cfg(target_os = "windows")]
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.set_decorations(false);
                let _ = window_vibrancy::apply_mica(&main_win, None);
            }

            // Build a custom menu with enriched About metadata
            let about_metadata = AboutMetadata {
                name: Some("NightFlow".into()),
                version: Some(app.package_info().version.to_string()),
                copyright: Some("Copyright \u{00A9} 2025 Krishnatheja Vanka".into()),
                comments: Some("Manage and analyze deep learning experiments locally.\nBuilt with Tauri, Preact, and PyTorch Lightning.".into()),
                website: Some("https://github.com/theja-vanka/NightFlow".into()),
                website_label: Some("GitHub Repository".into()),
                authors: Some(vec!["Krishnatheja Vanka".into()]),
                license: Some("Apache-2.0".into()),
                ..Default::default()
            };

            let app_submenu = SubmenuBuilder::new(app, "NightFlow")
                .about(Some(about_metadata))
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_submenu = SubmenuBuilder::new(app, "View")
                .fullscreen()
                .build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_submenu)
                .item(&edit_submenu)
                .item(&view_submenu)
                .item(&window_submenu)
                .build()?;

            app.set_menu(menu)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            close_splash,
            get_platform,
            window_minimize,
            window_maximize,
            window_close,
            pty::spawn_terminal,
            pty::pty_write,
            pty::pty_resize,
            pty::kill_terminal,
            pty::is_terminal_alive,
            pty::get_terminal_info,
            fs::write_file,
            ssh::ssh_write_file,
            ssh::test_ssh,
            ssh::ssh_mkdir,
            fs::get_cwd,
            fs::check_path_exists,
            ssh::ssh_check_path,
            ssh::list_ssh_keys,
            env::ensure_uv,
            env::ssh_ensure_uv,
            env::check_conda,
            env::ssh_check_conda,
            env::setup_python_env,
            env::ssh_setup_python_env,
            fs::ensure_project_dir,
            fs::validate_folder_path,
            fs::browse_dataset,
            fs::detect_dataset_splits,
            fs::validate_file_path,
            fs::validate_dataset_structure,
            training::start_training,
            training::stop_training,
            training::force_reset_training,
            training::is_training_alive,
            training::check_training_session,
            training::read_training_log,
            training::watch_training_log,
            runs::list_run_folders,
            runs::parse_run_jsonl,
            runs::parse_csv_run,
            runs::parse_hparams_yaml,
            runs::check_runs_checkpoints,
            system::get_system_metrics,
            system::download_model,
            system::push_to_hub,
            interpretation::save_interpretation_image,
            interpretation::run_interpretation,
            interpretation::export_jit_model,
            interpretation::preview_augmentation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

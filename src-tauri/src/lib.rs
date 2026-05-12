use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        self
    }
}

const PYTHON_PORT: u16 = 8765;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepInfo {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepsStatus {
    pub python: DepInfo,
    pub ffmpeg: DepInfo,
    pub silero_vad: DepInfo,
}

#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub success: bool,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StartResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ─── App State ────────────────────────────────────────────────────────────────

pub struct AppState {
    python_process: Mutex<Option<Child>>,
    deps_cache: Mutex<Option<DepsStatus>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            python_process: Mutex::new(None),
            deps_cache: Mutex::new(None),
        }
    }
}

// ─── Path Helpers ─────────────────────────────────────────────────────────────

fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_default()
}

fn python_scripts_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../python")
    } else {
        let by_exe = exe_dir().join("python");
        if by_exe.exists() {
            return by_exe;
        }
        app.path().resource_dir().unwrap_or_default().join("python")
    }
}

fn requirements_path(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../requirements.txt")
    } else {
        let by_exe = exe_dir().join("requirements.txt");
        if by_exe.exists() {
            return by_exe;
        }
        app.path().resource_dir().unwrap_or_default().join("requirements.txt")
    }
}

fn venv_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("python-venv")
}

fn venv_python(app: &AppHandle) -> PathBuf {
    let base = venv_dir(app);
    if cfg!(target_os = "windows") {
        base.join("Scripts").join("python.exe")
    } else {
        base.join("bin").join("python3")
    }
}

fn venv_pip(app: &AppHandle) -> PathBuf {
    let base = venv_dir(app);
    if cfg!(target_os = "windows") {
        base.join("Scripts").join("pip.exe")
    } else {
        base.join("bin").join("pip3")
    }
}

fn ffmpeg_path_file(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("ffmpeg-bin-path.txt")
}

fn local_ffmpeg_dir(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("ffmpeg")
}

fn deps_verified_path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_default().join("deps-ok.json")
}

// ─── FFmpeg Path ──────────────────────────────────────────────────────────────

fn stored_ffmpeg_bin(app: &AppHandle) -> Option<String> {
    std::fs::read_to_string(ffmpeg_path_file(app))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn store_ffmpeg_bin(app: &AppHandle, bin_dir: &str) {
    let _ = std::fs::write(ffmpeg_path_file(app), bin_dir);
}

fn find_local_ffmpeg_bin(app: &AppHandle) -> Option<String> {
    let base = local_ffmpeg_dir(app);
    if !base.exists() {
        return None;
    }
    let exe = if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let bin_dir = entry.path().join("bin");
            if bin_dir.join(exe).exists() {
                return Some(bin_dir.to_string_lossy().into_owned());
            }
        }
    }
    let direct = base.join("bin");
    if direct.join(exe).exists() {
        return Some(direct.to_string_lossy().into_owned());
    }
    None
}

fn env_with_ffmpeg(app: &AppHandle) -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let mut extra = Vec::new();
    if let Some(local) = find_local_ffmpeg_bin(app) { extra.push(local); }
    if let Some(stored) = stored_ffmpeg_bin(app) { extra.push(stored); }
    if !extra.is_empty() {
        let existing = env.get("PATH").cloned().unwrap_or_default();
        env.insert("PATH".to_string(), format!("{}{sep}{existing}", extra.join(sep)));
    }
    env
}

#[cfg(target_os = "windows")]
fn find_ffmpeg_in_registry_path() -> Option<String> {
    let ps = concat!(
        "$m = [System.Environment]::GetEnvironmentVariable('PATH','Machine'); ",
        "$u = [System.Environment]::GetEnvironmentVariable('PATH','User'); ",
        "$env:PATH = $m + ';' + $u + ';' + $env:PATH; ",
        "$c = Get-Command ffmpeg -ErrorAction SilentlyContinue; ",
        "if ($c) { Split-Path -Parent $c.Source } else { '' }"
    );
    Command::new("powershell")
        .args(["-NoProfile", "-Command", ps])
        .no_window()
        .output()
        .ok()
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        })
}

// ─── Streaming Command Helper ─────────────────────────────────────────────────

fn run_streaming(app: &AppHandle, mut cmd: Command) -> InstallResult {
    let app = app.clone();
    let mut child = match cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).no_window().spawn() {
        Ok(c) => c,
        Err(e) => return InstallResult { success: false, output: e.to_string(), manual: None },
    };

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let output = Arc::new(Mutex::new(String::new()));

    let app1 = app.clone();
    let out1 = output.clone();
    let t1 = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = app1.emit("app-log", &line);
            out1.lock().unwrap().push_str(&format!("{line}\n"));
        }
    });

    let app2 = app.clone();
    let out2 = output.clone();
    let t2 = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app2.emit("app-log", format!("[ERR] {line}"));
            out2.lock().unwrap().push_str(&format!("[ERR] {line}\n"));
        }
    });

    let success = child.wait().map(|s| s.success()).unwrap_or(false);
    t1.join().ok();
    t2.join().ok();

    let out = output.lock().unwrap().clone();
    InstallResult { success, output: out, manual: None }
}

// ─── Dep Checks ───────────────────────────────────────────────────────────────

fn check_python_sync() -> DepInfo {
    let bin = if cfg!(target_os = "windows") { "python" } else { "python3" };
    match Command::new(bin).arg("--version").no_window().output() {
        Ok(out) if out.status.success() => DepInfo {
            available: true,
            version: Some(String::from_utf8_lossy(&out.stdout).trim().to_string()),
        },
        _ => DepInfo { available: false, version: None },
    }
}

fn check_silero_vad_sync(app: &AppHandle) -> DepInfo {
    let python = venv_python(app);
    if !python.exists() {
        return DepInfo { available: false, version: None };
    }
    let ok = Command::new(&python)
        .args(["-c", "from silero_vad import load_silero_vad"])
        .no_window()
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    DepInfo { available: ok, version: None }
}

fn check_ffmpeg_sync(app: &AppHandle) -> DepInfo {
    let env = env_with_ffmpeg(app);

    let try_run = |e: HashMap<String, String>| -> Option<String> {
        Command::new("ffmpeg")
            .arg("-version")
            .envs(&e)
            .no_window()
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .to_string()
            })
    };

    if let Some(v) = try_run(env) {
        return DepInfo { available: true, version: Some(v) };
    }

    #[cfg(target_os = "windows")]
    if let Some(bin_dir) = find_ffmpeg_in_registry_path() {
        store_ffmpeg_bin(app, &bin_dir);
        let mut env2: HashMap<String, String> = std::env::vars().collect();
        let existing = env2.get("PATH").cloned().unwrap_or_default();
        env2.insert("PATH".to_string(), format!("{bin_dir};{existing}"));
        if let Some(v) = try_run(env2) {
            return DepInfo { available: true, version: Some(v) };
        }
    }

    DepInfo { available: false, version: None }
}

// ─── Venv Management ─────────────────────────────────────────────────────────

fn ensure_venv_sync(app: &AppHandle) -> Result<(), String> {
    let python_exe = venv_python(app);
    if python_exe.exists() {
        return Ok(());
    }
    let venv = venv_dir(app);
    let _ = app.emit("app-log", "[Main] Creating Python virtual environment…");

    let py_bin = if cfg!(target_os = "windows") { "python" } else { "python3" };
    let status = Command::new(py_bin)
        .args(["-m", "venv", &venv.to_string_lossy()])
        .no_window()
        .status();

    status
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err("venv creation failed".into()) })
}

// ─── Server Helpers ───────────────────────────────────────────────────────────

fn server_ready() -> bool {
    std::net::TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], PYTHON_PORT)),
        std::time::Duration::from_millis(200),
    )
    .is_ok()
}

fn resolve_ffmpeg_exe(app: &AppHandle) -> String {
    let env = env_with_ffmpeg(app);
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    Command::new(cmd)
        .arg("ffmpeg")
        .envs(&env)
        .no_window()
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "ffmpeg".to_string())
}

#[cfg(target_os = "windows")]
fn kill_port(port: u16) {
    let ps = format!(
        "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue \
         | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
    );
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps])
        .no_window()
        .output();
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn check_deps(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<DepsStatus, String> {
    if let Some(cached) = state.deps_cache.lock().unwrap().clone() {
        return Ok(cached);
    }
    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _ = ensure_venv_sync(&app_clone);
        let python = check_python_sync();
        let ffmpeg = check_ffmpeg_sync(&app_clone);
        let silero_vad = check_silero_vad_sync(&app_clone);
        DepsStatus { python, ffmpeg, silero_vad }
    })
    .await
    .map_err(|e| e.to_string())?;

    *state.deps_cache.lock().unwrap() = Some(result.clone());
    Ok(result)
}

#[tauri::command]
async fn install_pip_deps(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<InstallResult, String> {
    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        if let Err(e) = ensure_venv_sync(&app_clone) {
            return InstallResult { success: false, output: e, manual: None };
        }
        let pip = venv_pip(&app_clone);
        let req = requirements_path(&app_clone);
        let mut cmd = Command::new(&pip);
        cmd.args(["install", "--no-compile", "-r", &req.to_string_lossy()]);
        run_streaming(&app_clone, cmd)
    })
    .await
    .map_err(|e| e.to_string())?;

    if result.success {
        *state.deps_cache.lock().unwrap() = None;
    }
    Ok(result)
}

#[tauri::command]
async fn install_ffmpeg(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<InstallResult, String> {
    let app_clone = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            // Try winget first
            let mut cmd = Command::new("winget");
            cmd.args([
                "install", "--id", "Gyan.FFmpeg", "-e",
                "--silent", "--accept-package-agreements", "--accept-source-agreements",
            ]);
            let r = run_streaming(&app_clone, cmd);
            if r.success {
                if let Some(bin) = find_ffmpeg_in_registry_path() {
                    store_ffmpeg_bin(&app_clone, &bin);
                }
                return r;
            }

            // Fallback: download zip via PowerShell
            let dest = local_ffmpeg_dir(&app_clone).to_string_lossy().replace('\\', "\\\\");
            let ps = format!(
                "$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; \
                 $tmp=[System.IO.Path]::GetTempFileName()+'.zip'; \
                 Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $tmp -UseBasicParsing; \
                 Expand-Archive -Path $tmp -DestinationPath '{dest}' -Force; \
                 Remove-Item $tmp -Force; Write-Output 'done'"
            );
            let mut cmd2 = Command::new("powershell");
            cmd2.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &ps]);
            let r2 = run_streaming(&app_clone, cmd2);
            if r2.success {
                if let Some(bin) = find_local_ffmpeg_bin(&app_clone) {
                    store_ffmpeg_bin(&app_clone, &bin);
                    return InstallResult { success: true, output: r2.output, manual: None };
                }
            }
            InstallResult {
                success: false,
                output: r2.output,
                manual: Some("https://ffmpeg.org/download.html#build-windows".to_string()),
            }
        }

        #[cfg(target_os = "macos")]
        {
            let mut cmd = Command::new("brew");
            cmd.arg("install").arg("ffmpeg");
            let r = run_streaming(&app_clone, cmd);
            if r.success {
                r
            } else {
                InstallResult {
                    manual: Some("https://formulae.brew.sh/formula/ffmpeg".to_string()),
                    ..r
                }
            }
        }

        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        InstallResult {
            success: false,
            output: "Automatic install not supported on this platform.".to_string(),
            manual: Some("https://ffmpeg.org/download.html".to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    if result.success {
        *state.deps_cache.lock().unwrap() = None;
    }
    Ok(result)
}

#[tauri::command]
async fn start_server(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<StartResult, String> {
    // Check if already running
    {
        let guard = state.python_process.lock().unwrap();
        if guard.is_some() && server_ready() {
            return Ok(StartResult { success: true, error: None });
        }
    }
    // Kill stale process
    {
        let mut guard = state.python_process.lock().unwrap();
        if let Some(mut p) = guard.take() {
            let _ = p.kill();
        }
    }

    let app_clone = app.clone();

    // Capture the process handle
    let child_result = tokio::task::spawn_blocking(move || -> Result<Child, String> {
        #[cfg(target_os = "windows")]
        kill_port(PYTHON_PORT);

        std::thread::sleep(std::time::Duration::from_millis(800));

        let script = python_scripts_dir(&app_clone).join("main.py");
        let python = venv_python(&app_clone);
        let ffmpeg_exe = resolve_ffmpeg_exe(&app_clone);
        let env = env_with_ffmpeg(&app_clone);

        let _ = app_clone.emit("app-log", format!("[Main] Using ffmpeg: {ffmpeg_exe}"));

        let mut child = Command::new(&python)
            .arg(&script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .envs(&env)
            .env("FFMPEG_PATH", &ffmpeg_exe)
            .no_window()
            .spawn()
            .map_err(|e| e.to_string())?;

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let app1 = app_clone.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = app1.emit("app-log", &line);
            }
        });
        let app2 = app_clone.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = app2.emit("app-log", format!("[PY-ERR] {line}"));
            }
        });

        Ok(child)
    })
    .await
    .map_err(|e| e.to_string())?;

    match child_result {
        Err(e) => return Ok(StartResult { success: false, error: Some(e) }),
        Ok(child) => {
            *state.python_process.lock().unwrap() = Some(child);
        }
    }

    // Wait for server to be ready
    let app_clone2 = app.clone();
    tokio::task::spawn_blocking(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        let mut attempts = 0u32;
        loop {
            if std::time::Instant::now() >= deadline {
                return StartResult {
                    success: false,
                    error: Some("Python server timed out".to_string()),
                };
            }
            attempts += 1;
            if attempts % 10 == 0 {
                let _ = app_clone2.emit("app-log", format!("[Main] Connecting… (attempt {attempts})"));
            }
            if server_ready() {
                return StartResult { success: true, error: None };
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_deps_verified(app: AppHandle) -> bool {
    deps_verified_path(&app).exists()
}

#[tauri::command]
fn set_deps_verified(app: AppHandle) -> Result<(), String> {
    let content = serde_json::json!({ "verified": true, "ts": chrono_ts() }).to_string();
    std::fs::write(deps_verified_path(&app), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_deps_verified(app: AppHandle) {
    let _ = std::fs::remove_file(deps_verified_path(&app));
}

fn chrono_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tauri::command]
fn read_file(path: String) -> Result<Option<String>, String> {
    if !std::path::Path::new(&path).exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_user_data_path(app: AppHandle) -> Result<String, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_file_dialog(app: AppHandle) -> Result<Option<Vec<String>>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter(
            "Video & Audio",
            &["mp4", "mov", "mkv", "avi", "webm", "m4v", "mp3", "wav", "aac", "m4a"],
        )
        .pick_files(move |paths| {
            let result = paths.map(|ps| {
                ps.into_iter()
                    .filter_map(|p| p.into_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            });
            let _ = tx.send(result);
        });

    rx.await.map_err(|e| e.to_string())
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

// ─── App Entry Point ──────────────────────────────────────────────────────────

pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("[PANIC] {info}\n");
        eprintln!("{msg}");
        let _ = std::fs::write("rapidcut-crash.log", &msg);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            check_deps,
            install_pip_deps,
            install_ffmpeg,
            start_server,
            get_deps_verified,
            set_deps_verified,
            clear_deps_verified,
            read_file,
            write_file,
            get_user_data_path,
            open_file_dialog,
            open_external,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut guard) = state.python_process.lock() {
                        if let Some(mut p) = guard.take() {
                            let _ = p.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

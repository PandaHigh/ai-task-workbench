use std::sync::Mutex;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct EngineState {
    pub child: Option<CommandChild>,
}

fn find_engine_dir() -> std::path::PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));

    let candidates = vec![
        exe_dir.join("../../src-engine"),
        exe_dir.join("../../../src-engine"),
        std::path::PathBuf::from("../src-engine"),
    ];

    candidates.into_iter()
        .find(|d| d.join("src/index.ts").exists())
        .unwrap_or_else(|| std::path::PathBuf::from("../src-engine"))
}

/// Resolve npx binary path from common locations
fn find_npx() -> String {
    // Check common macOS locations
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = vec![
        format!("{home}/.nvm/versions/node/default/bin/npx"),
        "/opt/homebrew/bin/npx".to_string(),
        "/usr/local/bin/npx".to_string(),
        format!("{home}/.local/bin/npx"),
    ];

    for path in &candidates {
        if std::path::Path::new(path).exists() {
            println!("[sidecar] Found npx at {}", path);
            return path.clone();
        }
    }

    // Fallback: try to resolve via which
    if let Ok(output) = std::process::Command::new("/usr/bin/which")
        .arg("npx")
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                println!("[sidecar] Found npx via which: {}", path);
                return path;
            }
        }
    }

    // Last resort
    println!("[sidecar] npx not found in common paths, using 'npx' as-is");
    "npx".to_string()
}

pub fn start_engine(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<Mutex<EngineState>>();
    let mut engine = state.lock().unwrap();

    if engine.child.is_some() {
        println!("[sidecar] Engine already running");
        return Ok(());
    }

    let engine_dir = find_engine_dir();
    let engine_dir = std::fs::canonicalize(&engine_dir).unwrap_or(engine_dir);
    println!("[sidecar] Engine dir: {:?}", engine_dir);

    if !engine_dir.join("src/index.ts").exists() {
        eprintln!("[sidecar] Engine dir invalid: {:?} — frontend can use restart_engine RPC", engine_dir);
        return Ok(());
    }

    // Try sidecar binary first
    let child = match app.shell().sidecar("bin/engine") {
        Ok(cmd) => {
            println!("[sidecar] Trying sidecar binary...");
            match cmd.spawn() {
                Ok((_rx, child)) => {
                    println!("[sidecar] Engine sidecar started");
                    Some(child)
                }
                Err(e) => {
                    eprintln!("[sidecar] Sidecar spawn failed: {}", e);
                    spawn_npx_app(app, &engine_dir)?
                }
            }
        }
        Err(_) => spawn_npx_app(app, &engine_dir)?,
    };

    engine.child = child;
    Ok(())
}

fn spawn_npx_app(app: &App, engine_dir: &std::path::Path) -> Result<Option<CommandChild>, Box<dyn std::error::Error>> {
    let npx = find_npx();
    println!("[sidecar] Starting engine: {} tsx src/index.ts in {:?}", npx, engine_dir);

    let (_rx, child) = app.shell()
        .command(&npx)
        .args(["tsx", "src/index.ts"])
        .current_dir(engine_dir)
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .spawn()?;

    println!("[sidecar] Engine process spawned");
    Ok(Some(child))
}

fn spawn_npx_handle(app: &AppHandle, engine_dir: &std::path::Path) -> Result<Option<CommandChild>, Box<dyn std::error::Error>> {
    let npx = find_npx();
    let (_rx, child) = app.shell()
        .command(&npx)
        .args(["tsx", "src/index.ts"])
        .current_dir(engine_dir)
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .spawn()?;
    Ok(Some(child))
}

pub fn stop_engine(app: &AppHandle) {
    let state = app.state::<Mutex<EngineState>>();
    let mut engine = state.lock().unwrap();
    if let Some(child) = engine.child.take() {
        println!("[sidecar] Stopping engine...");
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn restart_engine(app: AppHandle) -> Result<String, String> {
    stop_engine(&app);
    std::thread::sleep(std::time::Duration::from_millis(500));
    let engine_dir = find_engine_dir();
    let engine_dir = std::fs::canonicalize(&engine_dir).unwrap_or(engine_dir);
    let state = app.state::<Mutex<EngineState>>();
    let mut engine = state.lock().unwrap();
    match spawn_npx_handle(&app, &engine_dir) {
        Ok(child) => {
            engine.child = child;
            Ok("Engine restarted".to_string())
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn engine_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<Mutex<EngineState>>();
    let engine = state.lock().unwrap();
    Ok(engine.child.is_some())
}

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

pub fn start_engine(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let state = app.state::<Mutex<EngineState>>();
    let mut engine = state.lock().unwrap();

    if engine.child.is_some() {
        println!("[sidecar] Engine already running");
        return Ok(());
    }

    let engine_dir = find_engine_dir();
    println!("[sidecar] Engine dir: {:?}", engine_dir);

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
                    eprintln!("[sidecar] Sidecar failed: {}", e);
                    npx_spawn_app(app, &engine_dir)?
                }
            }
        }
        Err(e) => {
            eprintln!("[sidecar] No sidecar: {}", e);
            npx_spawn_app(app, &engine_dir)?
        }
    };

    engine.child = child;
    Ok(())
}

fn npx_spawn_app(app: &App, engine_dir: &std::path::Path) -> Result<Option<CommandChild>, Box<dyn std::error::Error>> {
    if !engine_dir.join("src/index.ts").exists() {
        eprintln!("[sidecar] Engine dir not found: {:?} — engine needs manual start", engine_dir);
        return Ok(None);
    }
    println!("[sidecar] Starting via npx tsx...");
    let (_rx, child) = app.shell()
        .command("npx")
        .args(["tsx", "src/index.ts"])
        .current_dir(engine_dir)
        .spawn()?;
    println!("[sidecar] Engine started via npx");
    Ok(Some(child))
}

fn npx_spawn_handle(app: &AppHandle, engine_dir: &std::path::Path) -> Result<Option<CommandChild>, Box<dyn std::error::Error>> {
    if !engine_dir.join("src/index.ts").exists() {
        return Err("Engine directory not found".into());
    }
    let (_rx, child) = app.shell()
        .command("npx")
        .args(["tsx", "src/index.ts"])
        .current_dir(engine_dir)
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
    let state = app.state::<Mutex<EngineState>>();
    let mut engine = state.lock().unwrap();
    match npx_spawn_handle(&app, &engine_dir) {
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

use std::sync::Mutex;
use tauri::{App, AppHandle, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub struct EngineState {
    pub child: Option<CommandChild>,
}

/// Try to locate the engine source directory.
/// Priority: Tauri resource dir (production) > relative paths (development).
fn find_engine_dir(app: &App) -> std::path::PathBuf {
    // Production: bundled engine (esbuild single file)
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("src-engine");
        if bundled.join("dist/engine.js").exists() {
            println!("[sidecar] Found bundled engine at {:?}", bundled);
            return bundled;
        }
    }

    // Development fallback
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

/// Same logic for AppHandle (used in Tauri commands).
fn find_engine_dir_handle(app: &AppHandle) -> std::path::PathBuf {
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("src-engine");
        if bundled.join("dist/engine.js").exists() {
            return bundled;
        }
    }

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

fn find_node() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let node_path = std::path::PathBuf::from(appdata).join("fnm").join("node-versions");
            if node_path.exists() {
                if let Ok(entries) = std::fs::read_dir(&node_path) {
                    for entry in entries.flatten() {
                        let node_exe = entry.path().join("installation").join("node.exe");
                        if node_exe.exists() {
                            println!("[sidecar] Found node via fnm at {:?}", node_exe);
                            return node_exe.to_string_lossy().to_string();
                        }
                    }
                }
            }
        }
        // Check common locations
        let candidates = vec![
            "C:\\Program Files\\nodejs\\node.exe",
            "C:\\nodejs\\node.exe",
        ];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                println!("[sidecar] Found node at {}", path);
                return path.to_string();
            }
        }
        // Fallback to `where`
        if let Ok(output) = std::process::Command::new("where").arg("node.exe").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("").trim().to_string();
                if !path.is_empty() && std::path::Path::new(&path).exists() {
                    println!("[sidecar] Found node via where: {}", path);
                    return path;
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = vec!["/usr/bin/node", "/usr/local/bin/node"];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                println!("[sidecar] Found node at {}", path);
                return path.to_string();
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        let candidates = vec![
            format!("{home}/.nvm/versions/node/default/bin/node"),
            "/opt/homebrew/bin/node".to_string(),
            "/usr/local/bin/node".to_string(),
        ];
        for path in &candidates {
            if std::path::Path::new(path).exists() {
                println!("[sidecar] Found node at {}", path);
                return path.clone();
            }
        }
    }

    #[cfg(unix)]
    if let Ok(output) = std::process::Command::new("/usr/bin/which").arg("node").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                println!("[sidecar] Found node via which: {}", path);
                return path;
            }
        }
    }

    println!("[sidecar] node not found in common paths, using 'node' as-is");
    "node".to_string()
}

fn find_npx() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let npx_path = std::path::PathBuf::from(appdata).join("npm").join("npx.cmd");
            if npx_path.exists() {
                println!("[sidecar] Found npx at {:?}", npx_path);
                return npx_path.to_string_lossy().to_string();
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let linux_candidates = vec!["/usr/bin/npx", "/usr/local/bin/npx"];
        for path in &linux_candidates {
            if std::path::Path::new(path).exists() {
                println!("[sidecar] Found npx at {}", path);
                return path.to_string();
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
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
    }

    #[cfg(unix)]
    if let Ok(output) = std::process::Command::new("/usr/bin/which").arg("npx").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                println!("[sidecar] Found npx via which: {}", path);
                return path;
            }
        }
    }

    #[cfg(target_os = "windows")]
    if let Ok(output) = std::process::Command::new("where").arg("npx").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or("").trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                println!("[sidecar] Found npx via where: {}", path);
                return path;
            }
        }
    }

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

    let engine_dir = find_engine_dir(app);
    let engine_dir = std::fs::canonicalize(&engine_dir).unwrap_or(engine_dir);
    println!("[sidecar] Engine dir: {:?}", engine_dir);

    let has_src = engine_dir.join("src/index.ts").exists();
    let has_dist = engine_dir.join("dist/engine.js").exists();

    if !has_src && !has_dist {
        eprintln!("[sidecar] Engine dir invalid: {:?} — frontend can use restart_engine RPC", engine_dir);
        return Ok(());
    }

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
                    if has_src {
                        spawn_npx_app(app, &engine_dir)?
                    } else {
                        spawn_node_app(app, &engine_dir)?
                    }
                }
            }
        }
        Err(_) => {
            if has_src {
                spawn_npx_app(app, &engine_dir)?
            } else {
                spawn_node_app(app, &engine_dir)?
            }
        }
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

fn spawn_node_app(app: &App, engine_dir: &std::path::Path) -> Result<Option<CommandChild>, Box<dyn std::error::Error>> {
    let node = find_node();
    println!("[sidecar] Starting engine: {} dist/engine.js in {:?}", node, engine_dir);
    let (_rx, child) = app.shell()
        .command(&node)
        .args(["dist/engine.js"])
        .current_dir(engine_dir)
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .spawn()?;
    println!("[sidecar] Engine process spawned (node)");
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
    let engine_dir = find_engine_dir_handle(&app);
    let engine_dir = std::fs::canonicalize(&engine_dir).unwrap_or(engine_dir);
    let state = app.state::<Mutex<EngineState>>();
    let mut engine = state.lock().unwrap();

    let has_src = engine_dir.join("src/index.ts").exists();
    let result = if has_src {
        spawn_npx_handle(&app, &engine_dir)
    } else {
        let node = find_node();
        let (_rx, child) = app.shell()
            .command(&node)
            .args(["dist/engine.js"])
            .current_dir(&engine_dir)
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(Some(child))
    };

    match result {
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

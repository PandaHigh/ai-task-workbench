use std::sync::Mutex;
use tauri::Manager;

mod sidecar;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(Mutex::new(sidecar::EngineState { child: None }))
        .invoke_handler(tauri::generate_handler![
            sidecar::restart_engine,
            sidecar::engine_status,
        ])
        .setup(|app| {
            // Best-effort engine start — don't crash the app if it fails
            if let Err(e) = sidecar::start_engine(app) {
                eprintln!("[setup] Engine start failed: {} — frontend can restart via RPC", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                sidecar::stop_engine(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

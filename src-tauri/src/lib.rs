use std::sync::Mutex;
use tauri::Manager;

mod sidecar;

/// Send a POST /api/shutdown to the engine's HTTP server to trigger graceful shutdown.
/// Uses raw TCP to avoid adding a heavy HTTP dependency like reqwest.
fn graceful_stop_engine() {
    use std::io::{Read, Write};
    use std::net::TcpStream;

    if let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:9731".parse().unwrap(),
        std::time::Duration::from_secs(2),
    ) {
        let _ = stream.write_all(b"POST /api/shutdown HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\n\r\n");
        let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
        let mut _buf = [0u8; 256];
        let _ = stream.read(&mut _buf);
        // Give the engine a moment to clean up
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(Mutex::new(sidecar::EngineState { child: None }))
        .invoke_handler(tauri::generate_handler![
            sidecar::restart_engine,
            sidecar::engine_status,
        ])
        .setup(|app| {
            if let Err(e) = sidecar::start_engine(app) {
                eprintln!("[setup] Engine start failed: {} — frontend can restart via RPC", e);
            }
            // Show window after state is restored by window-state plugin
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                graceful_stop_engine();
                sidecar::stop_engine(window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

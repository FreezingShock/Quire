//! Launch at sign-in. The autostart plugin itself is registered in lib.rs; this
//! file only exposes the one command the page uses. Windows writes a per-user
//! Run key, and macOS a per-user LaunchAgent, so neither needs an administrator.

use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};
use tauri_plugin_autostart::ManagerExt;

#[tauri::command]
fn set_enabled<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<(), String> {
    let launch = app.autolaunch();
    let result = if enabled { launch.enable() } else { launch.disable() };
    result.map_err(|error| error.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("quireautostart")
        .invoke_handler(tauri::generate_handler![set_enabled])
        .build()
}
